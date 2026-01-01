import os
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Cookie
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
import bcrypt
from jose import jwt, JWTError

from ..models import GRCUser, get_db
from ..schemas import UserCreate, UserLogin, UserResponse, TokenResponse

router = APIRouter(prefix="/auth", tags=["Authentication"])

SECRET_KEY = os.getenv("SESSION_SECRET", "grc-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


def get_current_user(
    token: Optional[str] = Cookie(None, alias="grc_auth_token"),
    db: Session = Depends(get_db)
) -> Optional[GRCUser]:
    if not token:
        return None
    payload = decode_token(token)
    if not payload:
        return None
    username = payload.get("sub")
    if not username:
        return None
    user = db.query(GRCUser).filter(GRCUser.username == username).first()
    return user


def require_auth(
    token: Optional[str] = Cookie(None, alias="grc_auth_token"),
    db: Session = Depends(get_db)
) -> GRCUser:
    user = get_current_user(token, db)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is deactivated"
        )
    return user


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(request: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(GRCUser).filter(
        (GRCUser.username == request.username) | (GRCUser.email == request.email)
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username or email already exists"
        )
    
    user = GRCUser(
        username=request.username,
        email=request.email,
        password_hash=hash_password(request.password),
        display_name=request.display_name or request.username
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    token = create_access_token({"sub": user.username})
    response = JSONResponse(content={
        "message": "Registration successful",
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "display_name": user.display_name
        }
    }, status_code=status.HTTP_201_CREATED)
    response.set_cookie(
        key="grc_auth_token",
        value=token,
        httponly=True,
        max_age=ACCESS_TOKEN_EXPIRE_HOURS * 3600
    )
    return response


@router.post("/login")
def login(request: UserLogin, db: Session = Depends(get_db)):
    user = db.query(GRCUser).filter(GRCUser.username == request.username).first()
    if not user or not verify_password(request.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is deactivated"
        )
    
    user.last_login = datetime.utcnow()
    db.commit()
    
    token = create_access_token({"sub": user.username})
    response = JSONResponse(content={
        "message": "Login successful",
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "display_name": user.display_name
        }
    })
    response.set_cookie(
        key="grc_auth_token",
        value=token,
        httponly=True,
        max_age=ACCESS_TOKEN_EXPIRE_HOURS * 3600
    )
    return response


@router.post("/logout")
def logout():
    response = JSONResponse(content={"message": "Logged out successfully"})
    response.delete_cookie(key="grc_auth_token")
    return response


@router.get("/me")
def get_me(
    token: Optional[str] = Cookie(None, alias="grc_auth_token"),
    db: Session = Depends(get_db)
):
    user = get_current_user(token, db)
    if not user:
        return {"authenticated": False, "user": None}
    return {
        "authenticated": True,
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "display_name": user.display_name,
            "is_active": user.is_active,
            "created_at": user.created_at.isoformat(),
            "last_login": user.last_login.isoformat() if user.last_login else None
        }
    }
