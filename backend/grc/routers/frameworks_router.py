from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from ..models import (
    Framework, FrameworkDomain, ControlObjective, 
    FrameworkControl, FrameworkSubControl, GRCUser, get_db
)
from ..schemas import (
    FrameworkCreate, FrameworkUpdate, FrameworkResponse,
    DomainCreate, DomainResponse,
    ObjectiveCreate, ObjectiveResponse,
    FrameworkControlCreate, FrameworkControlResponse,
    SubControlResponse, FrameworkImport, MessageResponse
)
from .auth_router import require_auth

router = APIRouter(prefix="/frameworks", tags=["Frameworks"])


@router.get("", response_model=List[FrameworkResponse])
def list_frameworks(
    is_active: Optional[bool] = None,
    is_custom: Optional[bool] = None,
    is_mandatory: Optional[bool] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    query = db.query(Framework)
    
    if is_active is not None:
        query = query.filter(Framework.is_active == is_active)
    if is_custom is not None:
        query = query.filter(Framework.is_custom == is_custom)
    if is_mandatory is not None:
        query = query.filter(Framework.is_mandatory == is_mandatory)
    
    frameworks = query.offset(skip).limit(limit).all()
    
    result = []
    for framework in frameworks:
        domain_count = db.query(FrameworkDomain).filter(
            FrameworkDomain.framework_id == framework.id
        ).count()
        
        control_count = db.query(FrameworkControl).join(ControlObjective).join(FrameworkDomain).filter(
            FrameworkDomain.framework_id == framework.id
        ).count()
        
        result.append({
            "id": framework.id,
            "name": framework.name,
            "short_code": framework.short_code,
            "regulator": framework.regulator,
            "jurisdiction": framework.jurisdiction,
            "version": framework.version,
            "description": framework.description,
            "is_mandatory": framework.is_mandatory,
            "enforcement_type": framework.enforcement_type,
            "is_active": framework.is_active,
            "is_custom": framework.is_custom,
            "domain_count": domain_count,
            "control_count": control_count
        })
    
    return result


@router.post("", response_model=FrameworkResponse, status_code=status.HTTP_201_CREATED)
def create_framework(
    framework: FrameworkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    existing = db.query(Framework).filter(Framework.short_code == framework.short_code).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Framework with this short code already exists"
        )
    
    db_framework = Framework(
        name=framework.name,
        short_code=framework.short_code,
        regulator=framework.regulator,
        jurisdiction=framework.jurisdiction,
        version=framework.version,
        description=framework.description,
        is_mandatory=framework.is_mandatory,
        enforcement_type=framework.enforcement_type,
        is_custom=framework.is_custom
    )
    db.add(db_framework)
    db.commit()
    db.refresh(db_framework)
    return db_framework


@router.get("/{framework_id}", response_model=dict)
def get_framework(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    framework = db.query(Framework).options(
        joinedload(Framework.domains)
        .joinedload(FrameworkDomain.objectives)
        .joinedload(ControlObjective.controls)
        .joinedload(FrameworkControl.sub_controls)
    ).filter(Framework.id == framework_id).first()
    
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework not found"
        )
    
    return {
        "id": framework.id,
        "name": framework.name,
        "short_code": framework.short_code,
        "regulator": framework.regulator,
        "jurisdiction": framework.jurisdiction,
        "version": framework.version,
        "description": framework.description,
        "is_mandatory": framework.is_mandatory,
        "enforcement_type": framework.enforcement_type,
        "is_active": framework.is_active,
        "is_custom": framework.is_custom,
        "domains": [
            {
                "id": domain.id,
                "code": domain.code,
                "name": domain.name,
                "description": domain.description,
                "order": domain.order,
                "objectives": [
                    {
                        "id": obj.id,
                        "code": obj.code,
                        "name": obj.name,
                        "description": obj.description,
                        "order": obj.order,
                        "controls": [
                            {
                                "id": ctrl.id,
                                "code": ctrl.code,
                                "name": ctrl.name,
                                "statement": ctrl.statement,
                                "is_mandatory": ctrl.is_mandatory,
                                "order": ctrl.order,
                                "sub_controls": [
                                    {
                                        "id": sub.id,
                                        "code": sub.code,
                                        "name": sub.name,
                                        "statement": sub.statement,
                                        "order": sub.order
                                    }
                                    for sub in ctrl.sub_controls
                                ]
                            }
                            for ctrl in obj.controls
                        ]
                    }
                    for obj in domain.objectives
                ]
            }
            for domain in framework.domains
        ]
    }


@router.put("/{framework_id}", response_model=FrameworkResponse)
def update_framework(
    framework_id: int,
    framework_update: FrameworkUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    framework = db.query(Framework).filter(Framework.id == framework_id).first()
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework not found"
        )
    
    update_data = framework_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(framework, field, value)
    
    db.commit()
    db.refresh(framework)
    return framework


@router.delete("/{framework_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_framework(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    framework = db.query(Framework).filter(Framework.id == framework_id).first()
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework not found"
        )
    
    if not framework.is_custom:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete a standard framework"
        )
    
    db.delete(framework)
    db.commit()
    return None


@router.get("/{framework_id}/domains", response_model=List[DomainResponse])
def list_domains(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    framework = db.query(Framework).filter(Framework.id == framework_id).first()
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework not found"
        )
    
    domains = db.query(FrameworkDomain).filter(
        FrameworkDomain.framework_id == framework_id
    ).order_by(FrameworkDomain.order).all()
    return domains


@router.post("/{framework_id}/domains", response_model=DomainResponse, status_code=status.HTTP_201_CREATED)
def create_domain(
    framework_id: int,
    domain: DomainCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    framework = db.query(Framework).filter(Framework.id == framework_id).first()
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework not found"
        )
    
    db_domain = FrameworkDomain(
        framework_id=framework_id,
        code=domain.code,
        name=domain.name,
        description=domain.description,
        order=domain.order
    )
    db.add(db_domain)
    db.commit()
    db.refresh(db_domain)
    return db_domain


@router.get("/{framework_id}/domains/{domain_id}/objectives", response_model=List[ObjectiveResponse])
def list_objectives(
    framework_id: int,
    domain_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    domain = db.query(FrameworkDomain).filter(
        FrameworkDomain.id == domain_id,
        FrameworkDomain.framework_id == framework_id
    ).first()
    if not domain:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain not found"
        )
    
    objectives = db.query(ControlObjective).filter(
        ControlObjective.domain_id == domain_id
    ).order_by(ControlObjective.order).all()
    return objectives


@router.post("/{framework_id}/domains/{domain_id}/objectives", response_model=ObjectiveResponse, status_code=status.HTTP_201_CREATED)
def create_objective(
    framework_id: int,
    domain_id: int,
    objective: ObjectiveCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    domain = db.query(FrameworkDomain).filter(
        FrameworkDomain.id == domain_id,
        FrameworkDomain.framework_id == framework_id
    ).first()
    if not domain:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain not found"
        )
    
    db_objective = ControlObjective(
        domain_id=domain_id,
        code=objective.code,
        name=objective.name,
        description=objective.description,
        order=objective.order
    )
    db.add(db_objective)
    db.commit()
    db.refresh(db_objective)
    return db_objective


@router.get("/controls/{control_id}", response_model=FrameworkControlResponse)
def get_control(
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    control = db.query(FrameworkControl).filter(FrameworkControl.id == control_id).first()
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control not found"
        )
    return control


@router.post("/controls", response_model=FrameworkControlResponse, status_code=status.HTTP_201_CREATED)
def create_control(
    control: FrameworkControlCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    objective = db.query(ControlObjective).filter(
        ControlObjective.id == control.objective_id
    ).first()
    if not objective:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Objective not found"
        )
    
    db_control = FrameworkControl(
        objective_id=control.objective_id,
        code=control.code,
        name=control.name,
        statement=control.statement,
        is_mandatory=control.is_mandatory,
        implementation_guidance=control.implementation_guidance,
        testing_guidance=control.testing_guidance,
        order=control.order
    )
    db.add(db_control)
    db.commit()
    db.refresh(db_control)
    return db_control


@router.get("/controls/{control_id}/sub-controls", response_model=List[SubControlResponse])
def list_sub_controls(
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    control = db.query(FrameworkControl).filter(FrameworkControl.id == control_id).first()
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control not found"
        )
    
    sub_controls = db.query(FrameworkSubControl).filter(
        FrameworkSubControl.control_id == control_id
    ).order_by(FrameworkSubControl.order).all()
    return sub_controls


@router.post("/import", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
def import_framework(
    import_data: FrameworkImport,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    data = import_data.data
    
    if "name" not in data or "short_code" not in data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Import data must contain 'name' and 'short_code' fields"
        )
    
    existing = db.query(Framework).filter(Framework.short_code == data["short_code"]).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Framework with this short code already exists"
        )
    
    framework = Framework(
        name=data["name"],
        short_code=data["short_code"],
        regulator=data.get("regulator"),
        jurisdiction=data.get("jurisdiction"),
        version=data.get("version"),
        description=data.get("description"),
        is_mandatory=data.get("is_mandatory", False),
        is_custom=True
    )
    db.add(framework)
    db.flush()
    
    for domain_data in data.get("domains", []):
        domain = FrameworkDomain(
            framework_id=framework.id,
            code=domain_data["code"],
            name=domain_data["name"],
            description=domain_data.get("description"),
            order=domain_data.get("order", 0)
        )
        db.add(domain)
        db.flush()
        
        for obj_data in domain_data.get("objectives", []):
            objective = ControlObjective(
                domain_id=domain.id,
                code=obj_data["code"],
                name=obj_data["name"],
                description=obj_data.get("description"),
                order=obj_data.get("order", 0)
            )
            db.add(objective)
            db.flush()
            
            for ctrl_data in obj_data.get("controls", []):
                control = FrameworkControl(
                    objective_id=objective.id,
                    code=ctrl_data["code"],
                    name=ctrl_data["name"],
                    statement=ctrl_data.get("statement"),
                    is_mandatory=ctrl_data.get("is_mandatory", True),
                    order=ctrl_data.get("order", 0)
                )
                db.add(control)
                db.flush()
                
                for sub_data in ctrl_data.get("sub_controls", []):
                    sub_control = FrameworkSubControl(
                        control_id=control.id,
                        code=sub_data["code"],
                        name=sub_data["name"],
                        statement=sub_data.get("statement"),
                        order=sub_data.get("order", 0)
                    )
                    db.add(sub_control)
    
    db.commit()
    
    return MessageResponse(message="Framework imported successfully", id=framework.id)
