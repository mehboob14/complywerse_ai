from typing import Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from ....models import (
    PolicyStatement, PolicyStatementCompliance, GovernanceDocument,
    GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/dashboard", tags=["Compliance Dashboard"])


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    from fastapi import HTTPException, status
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


@router.get("/summary")
def get_compliance_summary(
    tenant_id: Optional[int] = None,
    document_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {
            "total_statements": 0,
            "by_status": {},
            "by_category": {},
            "by_priority": {},
            "compliance_score": 0.0
        }
    
    query = db.query(PolicyStatement).filter(PolicyStatement.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(PolicyStatement.tenant_id == tenant_id)
    
    if document_id:
        query = query.filter(PolicyStatement.document_id == document_id)
    
    statements = query.all()
    total_statements = len(statements)
    
    if total_statements == 0:
        return {
            "total_statements": 0,
            "by_status": {},
            "by_category": {},
            "by_priority": {},
            "compliance_score": 0.0
        }
    
    by_status = {
        "compliant": 0,
        "partially_compliant": 0,
        "non_compliant": 0,
        "not_assessed": 0,
        "not_applicable": 0
    }
    by_category = {}
    by_priority = {}
    
    total_score = 0.0
    scored_count = 0
    
    for stmt in statements:
        compliance = db.query(PolicyStatementCompliance).filter(
            PolicyStatementCompliance.statement_id == stmt.id
        ).first()
        
        status_val = compliance.compliance_status if compliance else "not_assessed"
        by_status[status_val] = by_status.get(status_val, 0) + 1
        
        category = stmt.category or "uncategorized"
        by_category[category] = by_category.get(category, 0) + 1
        
        priority = stmt.priority or "medium"
        by_priority[priority] = by_priority.get(priority, 0) + 1
        
        if compliance and compliance.compliance_score is not None:
            total_score += compliance.compliance_score
            scored_count += 1
    
    avg_score = round(total_score / scored_count, 1) if scored_count > 0 else 0.0
    
    compliant_count = by_status.get("compliant", 0)
    partially_count = by_status.get("partially_compliant", 0)
    non_compliant_count = by_status.get("non_compliant", 0)
    not_applicable_count = by_status.get("not_applicable", 0)
    
    applicable_count = total_statements - not_applicable_count
    if applicable_count > 0:
        weighted_score = ((compliant_count * 100) + (partially_count * 50)) / applicable_count
    else:
        weighted_score = 0.0
    
    return {
        "total_statements": total_statements,
        "by_status": by_status,
        "by_category": by_category,
        "by_priority": by_priority,
        "compliance_score": round(weighted_score, 1),
        "average_score": avg_score,
        "compliance_rate": round((compliant_count / applicable_count) * 100, 1) if applicable_count > 0 else 0.0,
        "statistics": {
            "mandatory_count": sum(1 for s in statements if s.is_mandatory),
            "active_count": sum(1 for s in statements if s.status == "active"),
            "assessed_count": total_statements - by_status.get("not_assessed", 0)
        }
    }


@router.get("/trends")
def get_compliance_trends(
    tenant_id: Optional[int] = None,
    months: int = Query(6, le=24, description="Number of months to look back"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"trends": [], "period_months": months}
    
    now = datetime.utcnow()
    trends = []
    
    for i in range(months - 1, -1, -1):
        month_start = (now.replace(day=1) - timedelta(days=i * 30)).replace(day=1)
        if i > 0:
            next_month = (month_start + timedelta(days=32)).replace(day=1)
        else:
            next_month = now
        
        query = db.query(PolicyStatementCompliance).filter(
            PolicyStatementCompliance.tenant_id.in_(user_tenants),
            PolicyStatementCompliance.assessment_date.isnot(None),
            PolicyStatementCompliance.assessment_date < next_month
        )
        
        if tenant_id:
            validate_tenant_access(current_user, tenant_id, db)
            query = query.filter(PolicyStatementCompliance.tenant_id == tenant_id)
        
        records = query.all()
        
        compliant = sum(1 for r in records if r.compliance_status == "compliant")
        partial = sum(1 for r in records if r.compliance_status == "partially_compliant")
        non_compliant = sum(1 for r in records if r.compliance_status == "non_compliant")
        total_assessed = len(records)
        
        applicable = compliant + partial + non_compliant
        compliance_rate = round((compliant / applicable) * 100, 1) if applicable > 0 else 0.0
        
        trends.append({
            "month": month_start.strftime("%Y-%m"),
            "total_assessed": total_assessed,
            "compliant": compliant,
            "partially_compliant": partial,
            "non_compliant": non_compliant,
            "compliance_rate": compliance_rate
        })
    
    return {
        "trends": trends,
        "period_months": months,
        "summary": {
            "current_rate": trends[-1]["compliance_rate"] if trends else 0.0,
            "previous_rate": trends[-2]["compliance_rate"] if len(trends) > 1 else 0.0,
            "trend_direction": "improving" if len(trends) > 1 and trends[-1]["compliance_rate"] > trends[-2]["compliance_rate"] else "declining" if len(trends) > 1 and trends[-1]["compliance_rate"] < trends[-2]["compliance_rate"] else "stable"
        }
    }


@router.get("/overdue")
def get_overdue_assessments(
    tenant_id: Optional[int] = None,
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"overdue": [], "total": 0}
    
    now = datetime.utcnow()
    
    query = db.query(PolicyStatementCompliance).filter(
        PolicyStatementCompliance.tenant_id.in_(user_tenants),
        PolicyStatementCompliance.next_assessment_date.isnot(None),
        PolicyStatementCompliance.next_assessment_date < now
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(PolicyStatementCompliance.tenant_id == tenant_id)
    
    total = query.count()
    overdue_records = query.order_by(PolicyStatementCompliance.next_assessment_date.asc()).limit(limit).all()
    
    result = []
    for record in overdue_records:
        statement = db.query(PolicyStatement).filter(
            PolicyStatement.id == record.statement_id
        ).first()
        
        document = None
        if statement:
            document = db.query(GovernanceDocument).filter(
                GovernanceDocument.id == statement.document_id
            ).first()
        
        owner = None
        if record.owner_id:
            owner = db.query(GRCUser).filter(GRCUser.id == record.owner_id).first()
        
        days_overdue = (now - record.next_assessment_date).days
        
        result.append({
            "compliance_id": record.id,
            "statement_id": record.statement_id,
            "statement_code": statement.statement_code if statement else None,
            "statement_summary": statement.statement_summary if statement else None,
            "document_id": statement.document_id if statement else None,
            "document_title": document.title if document else None,
            "document_code": document.document_code if document else None,
            "category": statement.category if statement else None,
            "priority": statement.priority if statement else None,
            "compliance_status": record.compliance_status,
            "next_assessment_date": record.next_assessment_date.isoformat() if record.next_assessment_date else None,
            "days_overdue": days_overdue,
            "owner_id": record.owner_id,
            "owner_name": owner.display_name if owner else None,
            "department": record.department,
            "last_assessment_date": record.assessment_date.isoformat() if record.assessment_date else None
        })
    
    by_priority = {}
    by_category = {}
    for item in result:
        priority = item.get("priority") or "medium"
        by_priority[priority] = by_priority.get(priority, 0) + 1
        
        category = item.get("category") or "uncategorized"
        by_category[category] = by_category.get(category, 0) + 1
    
    return {
        "overdue": result,
        "total": total,
        "by_priority": by_priority,
        "by_category": by_category,
        "summary": {
            "critical_overdue": by_priority.get("critical", 0),
            "high_overdue": by_priority.get("high", 0),
            "average_days_overdue": round(sum(r["days_overdue"] for r in result) / len(result), 1) if result else 0
        }
    }


@router.get("/by-document")
def get_compliance_by_document(
    tenant_id: Optional[int] = None,
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"documents": [], "total": 0}
    
    query = db.query(PolicyStatement).filter(PolicyStatement.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(PolicyStatement.tenant_id == tenant_id)
    
    statements = query.all()
    
    document_stats = {}
    
    for stmt in statements:
        doc_id = stmt.document_id
        if doc_id not in document_stats:
            document = db.query(GovernanceDocument).filter(GovernanceDocument.id == doc_id).first()
            document_stats[doc_id] = {
                "document_id": doc_id,
                "document_title": document.title if document else None,
                "document_code": document.document_code if document else None,
                "doc_type": document.doc_type if document else None,
                "total_statements": 0,
                "compliant": 0,
                "partially_compliant": 0,
                "non_compliant": 0,
                "not_assessed": 0,
                "not_applicable": 0
            }
        
        document_stats[doc_id]["total_statements"] += 1
        
        compliance = db.query(PolicyStatementCompliance).filter(
            PolicyStatementCompliance.statement_id == stmt.id
        ).first()
        
        status = compliance.compliance_status if compliance else "not_assessed"
        document_stats[doc_id][status] = document_stats[doc_id].get(status, 0) + 1
    
    documents_list = []
    for doc_id, stats in document_stats.items():
        applicable = stats["total_statements"] - stats["not_applicable"]
        if applicable > 0:
            compliance_rate = round((stats["compliant"] / applicable) * 100, 1)
        else:
            compliance_rate = 0.0
        
        stats["compliance_rate"] = compliance_rate
        documents_list.append(stats)
    
    documents_list.sort(key=lambda x: x["compliance_rate"])
    
    return {
        "documents": documents_list[:limit],
        "total": len(documents_list)
    }
