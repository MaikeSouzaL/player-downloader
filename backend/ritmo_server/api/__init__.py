"""Rotas HTTP do servidor."""

from fastapi import APIRouter

from . import cookies, downloads, files, info, media, reports

router = APIRouter()
router.include_router(info.router)
router.include_router(media.router)
router.include_router(downloads.router)
router.include_router(files.router)
router.include_router(reports.router)
router.include_router(cookies.router)
