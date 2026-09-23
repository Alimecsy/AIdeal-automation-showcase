import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import main


class FakeNode:
    def __init__(self, text):
        self.text = text

    def get_all_text(self):
        return self.text


class FakePage:
    url = "https://example.com/source"
    status = 200

    def css(self, selector):
        return type("Nodes", (), {"first": FakeNode("Example source") if selector == "title" else FakeNode("Evidence text")})()


class ResearchScraperTests(unittest.TestCase):
    def setUp(self):
        main.cache.clear()
        main.robots_cache.clear()
        main.domain_next_request.clear()
        main.redis_store.base_url = ""
        main.redis_store.token = ""

    def test_private_network_targets_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "Private network"):
            main.validate_url("http://127.0.0.1/internal")

    @patch.object(main, "robots_allowed", return_value="robots_allowed")
    @patch.object(main.Fetcher, "get", return_value=FakePage())
    def test_canonical_url_and_ttl_cache_prevent_duplicate_fetch(self, fetch, _robots):
        first = main.extract_source({"url": "https://example.com/source#section"})
        second = main.extract_source({"url": "https://example.com/source"})

        self.assertEqual(fetch.call_count, 1)
        self.assertFalse(first["cacheHit"])
        self.assertTrue(second["cacheHit"])
        self.assertEqual(first["url"], "https://example.com/source")

    @patch.object(main, "robots_allowed", return_value="robots_allowed")
    @patch.object(main.Fetcher, "get", return_value=type("RedirectedPage", (), {"url": "http://127.0.0.1/private", "status": 200})())
    def test_private_redirect_target_is_rejected(self, _fetch, _robots):
        with self.assertRaisesRegex(ValueError, "Private network"):
            main.extract_source({"url": "https://example.com/redirect"})


if __name__ == "__main__":
    unittest.main()
