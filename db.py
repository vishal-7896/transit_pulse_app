from sqlalchemy.orm import Session
from alchemy_models import engine


def get_session():
    return Session(engine)