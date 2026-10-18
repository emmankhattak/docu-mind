import os, datetime
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pwdlib import PasswordHash
from sqlalchemy.orm import Session as DBSession
from .db import Session, User
hasher = PasswordHash.recommended()
bearer = HTTPBearer()
def get_db():
    db = Session()
    try: yield db
    finally: db.close()
def token(user_id):
    return jwt.encode({"sub":str(user_id),"exp":datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=1)},os.environ["JWT_SECRET"],algorithm="HS256")
def current_user(credentials:HTTPAuthorizationCredentials=Depends(bearer),db:DBSession=Depends(get_db)):
    try:
        data=jwt.decode(credentials.credentials,os.environ["JWT_SECRET"],algorithms=["HS256"])
        user=db.get(User,int(data["sub"]))
    except (jwt.PyJWTError,ValueError,KeyError):
        user=None
    if not user: raise HTTPException(401,"Invalid token")
    return user
