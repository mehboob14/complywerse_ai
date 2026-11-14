# Default OPA/Rego policy bundle baked into ava-repo-scan for the conftest spec
# (repo_scan_tools.py). conftest has NO built-in policies — it tests input docs
# against the policies you give it; with none it finds nothing. This is a small,
# generic k8s/container security baseline so conftest produces real findings on a
# manifest out of the box. Owners can drop their own .rego beside this one (the
# scan points conftest at the whole /opt/conftest-policies dir) to enforce house
# rules. Rego v1 syntax (OPA 1.x / conftest 0.6x+): `deny contains msg if {...}`.
package main

import rego.v1

# hostNetwork shares the node's network namespace — container escape / sniffing surface.
deny contains msg if {
	input.kind == "Deployment"
	input.spec.template.spec.hostNetwork == true
	msg := sprintf("Deployment '%s' sets hostNetwork=true (shares the node network namespace)", [input.metadata.name])
}

# privileged containers get full host capabilities — effectively root on the node.
deny contains msg if {
	input.kind == "Deployment"
	some c in input.spec.template.spec.containers
	c.securityContext.privileged == true
	msg := sprintf("Deployment '%s' container '%s' runs privileged", [input.metadata.name, c.name])
}

# allowPrivilegeEscalation lets a process gain more privileges than its parent.
deny contains msg if {
	input.kind == "Deployment"
	some c in input.spec.template.spec.containers
	c.securityContext.allowPrivilegeEscalation == true
	msg := sprintf("Deployment '%s' container '%s' allows privilege escalation", [input.metadata.name, c.name])
}

# a mutable ':latest' tag makes the running image unverifiable / non-reproducible.
warn contains msg if {
	input.kind == "Deployment"
	some c in input.spec.template.spec.containers
	endswith(c.image, ":latest")
	msg := sprintf("Deployment '%s' container '%s' uses the mutable ':latest' image tag", [input.metadata.name, c.name])
}
