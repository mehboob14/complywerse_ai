"""AWS account deep inventory collector.

Replaces the shallow legacy ``collect_aws`` (which only counted EC2 in the home
region and returned bucket/RDS counts). This collector walks the account
capability-by-capability and, critically, MULTI-REGION: it enumerates the
enabled regions once and iterates them for every regional resource type.

Each resource TYPE is its own status section (``collect_section``). A credential
that can read EC2 but is denied RDS yields ``ec2 -> discovered`` and
``rds -> permission_denied`` while the collect as a whole still succeeds. The
flat top-level scalars (provider / account_id / alias / regions) carry identity.

Credential keys are reused EXACTLY from the legacy collector:
  aws_access_key_id, aws_secret_access_key, aws_session_token, aws_region.

READ-ONLY: only describe/list/get calls. No mutations. Every resource list is
bounded to keep the property blob sane; each section also carries a count.
"""
from __future__ import annotations

from typing import Any, Dict, List

from . import (  # noqa: F401
    register, collect_section, section, discovered,
    DISCOVERED, PERMISSION_DENIED, NOT_SUPPORTED, NOT_APPLICABLE, UNAVAILABLE, ERROR,
)

# Bound every resource list so one enormous account can't produce a multi-MB
# property blob. Applies per-section (total items across regions).
_MAX_ITEMS = 200
# Cap how many enabled regions we sweep for regional resources, so a global
# describe doesn't fan out to 30+ regions of API calls on every collect.
_MAX_REGIONS = 20


def _tag(tags, key: str):
    for t in tags or []:
        if t.get("Key") == key:
            return t.get("Value")
    return None


@register("aws_readonly")
def collect_aws(creds: Dict[str, Any]) -> Dict[str, Any]:
    """Deep, typed, multi-region inventory of an AWS account (read-only)."""
    try:
        import boto3  # type: ignore
    except ImportError:
        raise RuntimeError("boto3 not installed on this server")

    home_region = creds.get("aws_region") or "us-east-1"
    session = boto3.session.Session(
        aws_access_key_id=creds.get("aws_access_key_id"),
        aws_secret_access_key=creds.get("aws_secret_access_key"),
        aws_session_token=creds.get("aws_session_token") or None,
        region_name=home_region,
    )

    # ── Connect signal: sts get_caller_identity is the cheapest proof the
    # credential is usable at all. A hard failure here means "connect failed"
    # and must surface as a RuntimeError (mirrors the legacy connect behaviour).
    try:
        ident = session.client("sts").get_caller_identity()
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"AWS credential validation failed: {e}")

    account_id = ident.get("Account")
    caller_arn = ident.get("Arn")

    props: Dict[str, Any] = {
        "provider": "AWS",
        "account_id": account_id,
        "caller_arn": caller_arn,
        "home_region": home_region,
    }

    def _alias():
        aliases = session.client("iam").list_account_aliases().get("AccountAliases", [])
        return aliases[0] if aliases else None

    props["alias"] = None
    try:
        props["alias"] = _alias()
    except Exception:  # noqa: BLE001
        pass

    # ── Enabled regions ──────────────────────────────────────────────────────
    def _list_regions() -> List[str]:
        resp = session.client("ec2", region_name=home_region).describe_regions()
        return sorted(r["RegionName"] for r in resp.get("Regions", []))

    try:
        regions = _list_regions()
    except Exception:  # noqa: BLE001
        regions = [home_region]
    if not regions:
        regions = [home_region]
    props["regions"] = regions
    props["region_count"] = len(regions)

    # Regions we actually sweep for regional resources (home first, bounded).
    sweep = [home_region] + [r for r in regions if r != home_region]
    sweep = sweep[:_MAX_REGIONS]
    props["swept_regions"] = sweep

    # account section (identity summary as a status section too).
    props["account"] = discovered({
        "account_id": account_id,
        "alias": props["alias"],
        "caller_arn": caller_arn,
    })

    def ec2(region: str):
        return session.client("ec2", region_name=region)

    # ── VPCs ─────────────────────────────────────────────────────────────────
    def _vpcs():
        out: List[Dict[str, Any]] = []
        for region in sweep:
            for v in ec2(region).describe_vpcs().get("Vpcs", []):
                out.append({
                    "vpc_id": v.get("VpcId"),
                    "cidr_block": v.get("CidrBlock"),
                    "is_default": v.get("IsDefault"),
                    "state": v.get("State"),
                    "region": region,
                })
                if len(out) >= _MAX_ITEMS:
                    return {"count": len(out), "items": out, "truncated": True}
        return {"count": len(out), "items": out}
    props["vpcs"] = collect_section(_vpcs)

    # ── Subnets ──────────────────────────────────────────────────────────────
    def _subnets():
        out: List[Dict[str, Any]] = []
        for region in sweep:
            for s in ec2(region).describe_subnets().get("Subnets", []):
                out.append({
                    "subnet_id": s.get("SubnetId"),
                    "vpc_id": s.get("VpcId"),
                    "cidr_block": s.get("CidrBlock"),
                    "availability_zone": s.get("AvailabilityZone"),
                    "state": s.get("State"),
                    "region": region,
                })
                if len(out) >= _MAX_ITEMS:
                    return {"count": len(out), "items": out, "truncated": True}
        return {"count": len(out), "items": out}
    props["subnets"] = collect_section(_subnets)

    # ── Route tables ─────────────────────────────────────────────────────────
    def _route_tables():
        out: List[Dict[str, Any]] = []
        for region in sweep:
            for rt in ec2(region).describe_route_tables().get("RouteTables", []):
                routes = []
                for r in rt.get("Routes", []):
                    dest = (r.get("DestinationCidrBlock")
                            or r.get("DestinationIpv6CidrBlock")
                            or r.get("DestinationPrefixListId"))
                    target = (r.get("GatewayId") or r.get("NatGatewayId")
                              or r.get("TransitGatewayId") or r.get("InstanceId")
                              or r.get("NetworkInterfaceId")
                              or r.get("VpcPeeringConnectionId"))
                    routes.append({"destination": dest, "target": target})
                out.append({
                    "route_table_id": rt.get("RouteTableId"),
                    "vpc_id": rt.get("VpcId"),
                    "routes": routes,
                    "region": region,
                })
                if len(out) >= _MAX_ITEMS:
                    return {"count": len(out), "items": out, "truncated": True}
        return {"count": len(out), "items": out}
    props["route_tables"] = collect_section(_route_tables)

    # ── Security groups ──────────────────────────────────────────────────────
    def _security_groups():
        out: List[Dict[str, Any]] = []
        for region in sweep:
            for g in ec2(region).describe_security_groups().get("SecurityGroups", []):
                out.append({
                    "group_id": g.get("GroupId"),
                    "group_name": g.get("GroupName"),
                    "vpc_id": g.get("VpcId"),
                    "ingress_rule_count": len(g.get("IpPermissions", [])),
                    "egress_rule_count": len(g.get("IpPermissionsEgress", [])),
                    "region": region,
                })
                if len(out) >= _MAX_ITEMS:
                    return {"count": len(out), "items": out, "truncated": True}
        return {"count": len(out), "items": out}
    props["security_groups"] = collect_section(_security_groups)

    # ── EC2 instances (multi-region — the legacy bug fix) ────────────────────
    def _ec2_instances():
        out: List[Dict[str, Any]] = []
        for region in sweep:
            paginator = ec2(region).get_paginator("describe_instances")
            for page in paginator.paginate():
                for res in page.get("Reservations", []):
                    for i in res.get("Instances", []):
                        out.append({
                            "instance_id": i.get("InstanceId"),
                            "name": _tag(i.get("Tags"), "Name"),
                            "state": (i.get("State") or {}).get("Name"),
                            "instance_type": i.get("InstanceType"),
                            "image_id": i.get("ImageId"),
                            "platform": i.get("Platform") or "linux",
                            "architecture": i.get("Architecture"),
                            "private_ip": i.get("PrivateIpAddress"),
                            "public_ip": i.get("PublicIpAddress"),
                            "vpc_id": i.get("VpcId"),
                            "subnet_id": i.get("SubnetId"),
                            "availability_zone": (i.get("Placement") or {}).get("AvailabilityZone"),
                            "iam_role": (i.get("IamInstanceProfile") or {}).get("Arn"),
                            "security_group_ids": [g.get("GroupId") for g in i.get("SecurityGroups", [])],
                            "launch_time": str(i.get("LaunchTime")) if i.get("LaunchTime") else None,
                            "region": region,
                        })
                        if len(out) >= _MAX_ITEMS:
                            return {"count": len(out), "items": out, "truncated": True}
        return {"count": len(out), "items": out}
    props["ec2"] = collect_section(_ec2_instances)

    # ── EBS volumes ──────────────────────────────────────────────────────────
    def _ebs_volumes():
        out: List[Dict[str, Any]] = []
        for region in sweep:
            for v in ec2(region).describe_volumes().get("Volumes", []):
                attachments = v.get("Attachments", [])
                out.append({
                    "volume_id": v.get("VolumeId"),
                    "size_gib": v.get("Size"),
                    "volume_type": v.get("VolumeType"),
                    "iops": v.get("Iops"),
                    "encrypted": v.get("Encrypted"),
                    "availability_zone": v.get("AvailabilityZone"),
                    "attached_instance_id": attachments[0].get("InstanceId") if attachments else None,
                    "region": region,
                })
                if len(out) >= _MAX_ITEMS:
                    return {"count": len(out), "items": out, "truncated": True}
        return {"count": len(out), "items": out}
    props["ebs_volumes"] = collect_section(_ebs_volumes)

    # ── Network interfaces ───────────────────────────────────────────────────
    def _network_interfaces():
        out: List[Dict[str, Any]] = []
        for region in sweep:
            for eni in ec2(region).describe_network_interfaces().get("NetworkInterfaces", []):
                private_ips = [p.get("PrivateIpAddress") for p in eni.get("PrivateIpAddresses", [])]
                assoc = eni.get("Association") or {}
                out.append({
                    "eni_id": eni.get("NetworkInterfaceId"),
                    "private_ips": private_ips,
                    "public_ip": assoc.get("PublicIp"),
                    "mac": eni.get("MacAddress"),
                    "subnet_id": eni.get("SubnetId"),
                    "vpc_id": eni.get("VpcId"),
                    "security_group_ids": [g.get("GroupId") for g in eni.get("Groups", [])],
                    "region": region,
                })
                if len(out) >= _MAX_ITEMS:
                    return {"count": len(out), "items": out, "truncated": True}
        return {"count": len(out), "items": out}
    props["network_interfaces"] = collect_section(_network_interfaces)

    # ── RDS ──────────────────────────────────────────────────────────────────
    def _rds():
        out: List[Dict[str, Any]] = []
        for region in sweep:
            client = session.client("rds", region_name=region)
            for db in client.describe_db_instances().get("DBInstances", []):
                endpoint = db.get("Endpoint") or {}
                out.append({
                    "db_instance_id": db.get("DBInstanceIdentifier"),
                    "engine": db.get("Engine"),
                    "engine_version": db.get("EngineVersion"),
                    "instance_class": db.get("DBInstanceClass"),
                    "status": db.get("DBInstanceStatus"),
                    "multi_az": db.get("MultiAZ"),
                    "storage_gb": db.get("AllocatedStorage"),
                    "endpoint_address": endpoint.get("Address"),
                    "region": region,
                })
                if len(out) >= _MAX_ITEMS:
                    return {"count": len(out), "items": out, "truncated": True}
        return {"count": len(out), "items": out}
    props["rds"] = collect_section(_rds)

    # ── S3 (global list; region + encryption resolved per bucket) ────────────
    def _s3():
        client = session.client("s3")
        buckets = client.list_buckets().get("Buckets", [])
        out: List[Dict[str, Any]] = []
        for b in buckets:
            name = b.get("Name")
            region = None
            try:
                loc = client.get_bucket_location(Bucket=name).get("LocationConstraint")
                region = loc or "us-east-1"
            except Exception:  # noqa: BLE001
                region = None
            encryption = "unknown"
            try:
                client.get_bucket_encryption(Bucket=name)
                encryption = "on"
            except Exception as e:  # noqa: BLE001
                msg = str(e).lower()
                encryption = "off" if "encryptionconfigurationnotfound" in msg else "unknown"
            out.append({
                "bucket_name": name,
                "region": region,
                "creation_date": str(b.get("CreationDate")) if b.get("CreationDate") else None,
                "encryption": encryption,
            })
            if len(out) >= _MAX_ITEMS:
                return {"count": len(out), "items": out, "truncated": True}
        return {"count": len(out), "items": out}
    props["s3"] = collect_section(_s3)

    # ── Lambda ───────────────────────────────────────────────────────────────
    def _lambda():
        out: List[Dict[str, Any]] = []
        for region in sweep:
            client = session.client("lambda", region_name=region)
            paginator = client.get_paginator("list_functions")
            for page in paginator.paginate():
                for f in page.get("Functions", []):
                    out.append({
                        "function_name": f.get("FunctionName"),
                        "runtime": f.get("Runtime"),
                        "memory_mb": f.get("MemorySize"),
                        "timeout_s": f.get("Timeout"),
                        "last_modified": f.get("LastModified"),
                        "region": region,
                    })
                    if len(out) >= _MAX_ITEMS:
                        return {"count": len(out), "items": out, "truncated": True}
        return {"count": len(out), "items": out}
    props["lambda"] = collect_section(_lambda)

    # ── ECS clusters ─────────────────────────────────────────────────────────
    def _ecs():
        out: List[Dict[str, Any]] = []
        for region in sweep:
            client = session.client("ecs", region_name=region)
            for arn in client.list_clusters().get("clusterArns", []):
                out.append({"cluster_arn": arn, "region": region})
                if len(out) >= _MAX_ITEMS:
                    return {"count": len(out), "items": out, "truncated": True}
        return {"count": len(out), "items": out}
    props["ecs"] = collect_section(_ecs)

    # ── EKS clusters ─────────────────────────────────────────────────────────
    def _eks():
        out: List[Dict[str, Any]] = []
        for region in sweep:
            client = session.client("eks", region_name=region)
            for name in client.list_clusters().get("clusters", []):
                out.append({"name": name, "region": region})
                if len(out) >= _MAX_ITEMS:
                    return {"count": len(out), "items": out, "truncated": True}
        return {"count": len(out), "items": out}
    props["eks"] = collect_section(_eks)

    # ── Load balancers (ELBv2) ───────────────────────────────────────────────
    def _elbv2():
        out: List[Dict[str, Any]] = []
        for region in sweep:
            client = session.client("elbv2", region_name=region)
            for lb in client.describe_load_balancers().get("LoadBalancers", []):
                out.append({
                    "name": lb.get("LoadBalancerName"),
                    "arn": lb.get("LoadBalancerArn"),
                    "type": lb.get("Type"),
                    "scheme": lb.get("Scheme"),
                    "dns_name": lb.get("DNSName"),
                    "vpc_id": lb.get("VpcId"),
                    "state": (lb.get("State") or {}).get("Code"),
                    "region": region,
                })
                if len(out) >= _MAX_ITEMS:
                    return {"count": len(out), "items": out, "truncated": True}
        return {"count": len(out), "items": out}
    props["elbv2"] = collect_section(_elbv2)

    # ── DynamoDB table names ─────────────────────────────────────────────────
    def _dynamodb():
        out: List[Dict[str, Any]] = []
        for region in sweep:
            client = session.client("dynamodb", region_name=region)
            for name in client.list_tables().get("TableNames", []):
                out.append({"table_name": name, "region": region})
                if len(out) >= _MAX_ITEMS:
                    return {"count": len(out), "items": out, "truncated": True}
        return {"count": len(out), "items": out}
    props["dynamodb"] = collect_section(_dynamodb)

    # ── SQS queue count ──────────────────────────────────────────────────────
    def _sqs():
        total = 0
        per_region: List[Dict[str, Any]] = []
        for region in sweep:
            client = session.client("sqs", region_name=region)
            urls = client.list_queues().get("QueueUrls", []) or []
            if urls:
                per_region.append({"region": region, "count": len(urls)})
                total += len(urls)
        return {"count": total, "by_region": per_region}
    props["sqs"] = collect_section(_sqs)

    # ── SNS topic count ──────────────────────────────────────────────────────
    def _sns():
        total = 0
        per_region: List[Dict[str, Any]] = []
        for region in sweep:
            client = session.client("sns", region_name=region)
            topics = client.list_topics().get("Topics", []) or []
            if topics:
                per_region.append({"region": region, "count": len(topics)})
                total += len(topics)
        return {"count": total, "by_region": per_region}
    props["sns"] = collect_section(_sns)

    return props
