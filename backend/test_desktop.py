"""Regression checks for the packaged app's routing and local server lifecycle."""
import socket

from fastapi.testclient import TestClient
import httpx
import pytest

from desktop import LocalServer, create_app


@pytest.fixture
def desktop_app(tmp_path):
    (tmp_path / "index.html").write_text('<div id="root"></div>', encoding="utf-8")
    (tmp_path / "static").mkdir()
    (tmp_path / "static" / "app.js").write_text("console.log('HSI');", encoding="utf-8")
    return create_app(tmp_path)


def test_ui_api_and_missing_routes_are_distinct(desktop_app, tmp_path):
    with TestClient(desktop_app, base_url="http://127.0.0.1:12345") as client:
        assert client.get("/").text == '<div id="root"></div>'
        assert client.get("/static/app.js").status_code == 200
        response = client.get("/api/measurements", params={"folder_path": str(tmp_path)})
        assert response.status_code == 200
        assert response.json()["measurements"] == []
        assert client.get("/api/unknown").status_code == 404
        assert client.get("/missing.js").status_code == 404


def test_local_files_cannot_be_accessed_by_an_unrelated_website(desktop_app):
    with TestClient(desktop_app, base_url="http://127.0.0.1:12345") as client:
        assert client.get("/health", headers={"Origin": "http://127.0.0.1:12345"}).status_code == 200
        assert client.get("/health", headers={"Origin": "https://example.com"}).status_code == 403
        assert client.get("/health", headers={"Origin": "null"}).status_code == 403
        assert client.get("/health", headers={"Host": "example.com"}).status_code == 400


def test_missing_frontend_is_a_startup_error(tmp_path):
    with pytest.raises(FileNotFoundError, match="interface is missing"):
        create_app(tmp_path)


def test_servers_choose_free_ports_and_release_them(desktop_app):
    first, second = LocalServer(desktop_app), LocalServer(desktop_app)
    try:
        first.start()
        second.start()
        assert first.url != second.url
        with httpx.Client(trust_env=False) as client:
            assert client.get(first.url + "/health").json()["status"] == "ready"
            assert client.get(second.url + "/health").status_code == 200
        address = first.socket.getsockname()
    finally:
        first.stop()
        second.stop()
    assert not first.thread.is_alive()
    assert not second.thread.is_alive()
    with socket.socket() as probe:
        assert probe.connect_ex(address) != 0
