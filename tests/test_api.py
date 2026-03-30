"""
Integration tests for the AI Tab Optimizer FastAPI server.
Tests run against an in-memory SQLite database (see conftest.py).

All endpoint response shapes match the actual API contract in agent.py:
  GET  /settings          → {"settings": {...}}
  POST /settings          → {"settings": {...}}
  POST /tab-analysis-status → {"statuses": [...], "summary": {...}}
  POST /url-analysis/import → {"saved": N}
  GET  /clusters          → {"clusters": [...]}
  POST /clusters/merge    → {"merged": N, "created": N}
  GET  /snapshots         → {"snapshots": [...]}
  GET  /cache-stats       → {"totalUrls": N, ...}
  GET  /cache/urls        → {"entries": [...], "total": N}
"""
import time
import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_tab(tab_id: int, url: str, title: str = "Title", domain: str = "example.com") -> dict:
    """Minimal valid TabInput payload (all required fields included)."""
    return {
        "id": tab_id,
        "url": url,
        "title": title,
        "domain": domain,
        "pinned": False,
        "active": False,
    }


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

class TestHealth:
    def test_health_returns_ok(self, client):
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

class TestSettings:
    def test_get_settings_returns_defaults(self, client):
        response = client.get("/settings")
        assert response.status_code == 200
        data = response.json()
        assert "settings" in data
        settings = data["settings"]
        assert "serverAiProvider" in settings
        assert "fallbackAiProvider" in settings

    def test_save_and_reload_settings(self, client):
        payload = {"settings": {"serverAiProvider": "codex_cli", "fallbackAiProvider": "none"}}
        save_resp = client.post("/settings", json=payload)
        assert save_resp.status_code == 200

        load_resp = client.get("/settings")
        assert load_resp.status_code == 200
        settings = load_resp.json()["settings"]
        assert settings["serverAiProvider"] == "codex_cli"
        assert settings["fallbackAiProvider"] == "none"

    def test_saved_settings_are_returned_immediately(self, client):
        payload = {"settings": {"codexModel": "gpt-test-model"}}
        resp = client.post("/settings", json=payload)
        assert resp.status_code == 200
        assert resp.json()["settings"]["codexModel"] == "gpt-test-model"


# ---------------------------------------------------------------------------
# Tab analysis status
# ---------------------------------------------------------------------------

class TestTabAnalysisStatus:
    def test_all_tabs_pending_when_cache_is_empty(self, client):
        tabs = [
            make_tab(1, "https://example.com/a", "A", "example.com"),
            make_tab(2, "https://example.com/b", "B", "example.com"),
        ]
        response = client.post("/tab-analysis-status", json={"tabs": tabs})
        assert response.status_code == 200
        data = response.json()

        statuses = {s["tabId"]: s for s in data["statuses"]}
        assert statuses[1]["status"] == "pending"
        assert statuses[2]["status"] == "pending"

        summary = data["summary"]
        assert summary["total"] == 2
        assert summary["pending"] == 2
        assert summary["cached"] == 0

    def test_tab_appears_cached_after_url_analysis_import(self, client):
        tab = make_tab(10, "https://cached.example.com/page", "Cached", "cached.example.com")

        import_payload = {
            "tabs": [tab],
            "recommendations": [
                {
                    "tabId": 10,
                    "action": "keep",
                    "confidence": 0.9,
                    "reason": "Useful reference",
                    "suggestedGroupName": None,
                }
            ],
            "analysisSource": "heuristic",
            "provider": None,
            "model": None,
        }
        import_resp = client.post("/url-analysis/import", json=import_payload)
        assert import_resp.status_code == 200

        status_resp = client.post("/tab-analysis-status", json={"tabs": [tab]})
        assert status_resp.status_code == 200
        data = status_resp.json()

        statuses = {s["tabId"]: s for s in data["statuses"]}
        assert statuses[10]["status"] in ("cached", "analyzed")
        assert data["summary"]["pending"] == 0

    def test_empty_tab_list_returns_empty_statuses(self, client):
        response = client.post("/tab-analysis-status", json={"tabs": []})
        assert response.status_code == 200
        data = response.json()
        assert data["statuses"] == []
        assert data["summary"]["total"] == 0


# ---------------------------------------------------------------------------
# URL analysis import
# ---------------------------------------------------------------------------

class TestUrlAnalysisImport:
    def test_import_single_result(self, client):
        tab = make_tab(5, "https://import.example.com/doc", "Doc", "import.example.com")
        rec = {
            "tabId": 5,
            "action": "archive",
            "confidence": 0.7,
            "reason": "Old reference",
            "suggestedGroupName": None,
        }

        response = client.post("/url-analysis/import", json={
            "tabs": [tab],
            "recommendations": [rec],
            "analysisSource": "heuristic",
            "provider": None,
            "model": None,
        })
        assert response.status_code == 200
        assert response.json()["saved"] >= 1

    def test_import_returns_zero_saved_for_empty_payload(self, client):
        response = client.post("/url-analysis/import", json={
            "tabs": [],
            "recommendations": [],
            "analysisSource": "heuristic",
            "provider": None,
            "model": None,
        })
        assert response.status_code == 200
        assert response.json()["saved"] == 0

    def test_import_multiple_results_counts_correctly(self, client):
        tabs = [
            make_tab(1, "https://a.example.com/", "A", "a.example.com"),
            make_tab(2, "https://b.example.com/", "B", "b.example.com"),
        ]
        recs = [
            {"tabId": 1, "action": "keep", "confidence": 0.8, "reason": "Useful", "suggestedGroupName": None},
            {"tabId": 2, "action": "close", "confidence": 0.6, "reason": "Stale", "suggestedGroupName": None},
        ]
        response = client.post("/url-analysis/import", json={
            "tabs": tabs,
            "recommendations": recs,
            "analysisSource": "heuristic",
            "provider": None,
            "model": None,
        })
        assert response.status_code == 200
        assert response.json()["saved"] == 2


# ---------------------------------------------------------------------------
# Clusters
# ---------------------------------------------------------------------------

class TestClusters:
    def test_list_clusters_empty_initially(self, client):
        response = client.get("/clusters")
        assert response.status_code == 200
        assert response.json()["clusters"] == []

    def test_merge_creates_a_new_cluster(self, client):
        payload = {
            "clusters": [
                {
                    "name": "Python Resources",
                    "tabIds": [1, 2],
                    "tabUrls": ["https://python.org", "https://pypi.org"],
                    "description": "Python ecosystem tabs",
                    "tags": ["python", "dev"],
                }
            ]
        }
        merge_resp = client.post("/clusters/merge", json=payload)
        assert merge_resp.status_code == 200

        list_resp = client.get("/clusters")
        clusters = list_resp.json()["clusters"]
        assert len(clusters) == 1
        assert clusters[0]["name"] == "Python Resources"

    def test_rename_cluster(self, client):
        client.post("/clusters/merge", json={
            "clusters": [{"name": "Old Name", "tabIds": [], "tabUrls": [], "description": "", "tags": []}]
        })
        cluster_id = client.get("/clusters").json()["clusters"][0]["id"]

        rename_resp = client.put(f"/clusters/{cluster_id}", json={"name": "New Name"})
        assert rename_resp.status_code == 200

        updated = client.get("/clusters").json()["clusters"][0]
        assert updated["name"] == "New Name"

    def test_delete_cluster(self, client):
        client.post("/clusters/merge", json={
            "clusters": [{"name": "To Delete", "tabIds": [], "tabUrls": [], "description": "", "tags": []}]
        })
        cluster_id = client.get("/clusters").json()["clusters"][0]["id"]

        delete_resp = client.delete(f"/clusters/{cluster_id}")
        assert delete_resp.status_code == 200

        remaining = client.get("/clusters").json()["clusters"]
        assert remaining == []

    def test_merge_deduplicates_by_name(self, client):
        cluster = {"name": "Dedup Test", "tabIds": [], "tabUrls": ["https://a.com"], "description": "", "tags": ["a"]}
        client.post("/clusters/merge", json={"clusters": [cluster]})
        client.post("/clusters/merge", json={"clusters": [cluster]})

        clusters = client.get("/clusters").json()["clusters"]
        assert len(clusters) == 1


# ---------------------------------------------------------------------------
# Snapshots
# ---------------------------------------------------------------------------

class TestSnapshots:
    def _make_snapshot(self, snap_id: str, name: str = "Snapshot") -> dict:
        return {
            "id": snap_id,
            "name": name,
            "createdAt": int(time.time() * 1000),
            "trigger": "manual",
            "windows": [],
            "stats": {"totalTabs": 0, "totalWindows": 0, "topDomains": []},
        }

    def test_list_snapshots_empty_initially(self, client):
        response = client.get("/snapshots")
        assert response.status_code == 200
        assert response.json()["snapshots"] == []

    def test_create_and_retrieve_snapshot(self, client):
        snapshot = self._make_snapshot("snap-001", "Test Snapshot")
        create_resp = client.post("/snapshots", json={"snapshot": snapshot})
        assert create_resp.status_code == 200

        list_resp = client.get("/snapshots")
        snapshots = list_resp.json()["snapshots"]
        assert len(snapshots) == 1
        assert snapshots[0]["id"] == "snap-001"

    def test_delete_snapshot(self, client):
        client.post("/snapshots", json={"snapshot": self._make_snapshot("snap-del", "Delete Me")})

        del_resp = client.delete("/snapshots/snap-del")
        assert del_resp.status_code == 200

        remaining = client.get("/snapshots").json()["snapshots"]
        assert remaining == []

    def test_delete_nonexistent_snapshot_returns_404(self, client):
        resp = client.delete("/snapshots/does-not-exist")
        assert resp.status_code == 404

    def test_multiple_snapshots_are_all_listed(self, client):
        for i in range(3):
            client.post("/snapshots", json={"snapshot": self._make_snapshot(f"snap-{i}")})

        snapshots = client.get("/snapshots").json()["snapshots"]
        assert len(snapshots) == 3


# ---------------------------------------------------------------------------
# Cache stats
# ---------------------------------------------------------------------------

class TestCacheStats:
    def test_cache_stats_returns_total_urls(self, client):
        response = client.get("/cache-stats")
        assert response.status_code == 200
        data = response.json()
        assert "totalUrls" in data
        assert data["totalUrls"] == 0

    def test_cache_url_list_empty_initially(self, client):
        response = client.get("/cache/urls")
        assert response.status_code == 200
        data = response.json()
        assert "entries" in data
        assert data["entries"] == []
        assert data["total"] == 0

    def test_cache_stats_reflect_imported_analysis(self, client):
        tab = make_tab(99, "https://stats.example.com/x", "Stats", "stats.example.com")
        client.post("/url-analysis/import", json={
            "tabs": [tab],
            "recommendations": [
                {"tabId": 99, "action": "keep", "confidence": 1.0, "reason": "test", "suggestedGroupName": None}
            ],
            "analysisSource": "heuristic",
            "provider": None,
            "model": None,
        })

        stats = client.get("/cache-stats").json()
        assert stats["totalUrls"] >= 1
