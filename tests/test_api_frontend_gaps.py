"""Backend gaps for the frontend integration: serving design/, misc."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from brew.api.app import create_app
from brew.settings import Settings
from gaps_common import API

pytestmark = pytest.mark.integration


def test_design_served(gap_client):
    c = gap_client
    r = c.get("/")
    assert r.status_code == 200 and "brew" in r.text.lower()
    assert c.get("/lobby.js").status_code == 200
    assert c.get(f"{API}/health").json()["status"] == "ok"
    assert c.get(f"{API}/nope").status_code == 404


def test_design_can_be_disabled():
    app = create_app(Settings(db_enabled=False, serve_design=False))
    with TestClient(app) as cl:
        assert cl.get("/").status_code == 404
