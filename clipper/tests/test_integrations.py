from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline import integrations


class IntegrationStatusTests(unittest.TestCase):
    def test_disabled_providers_are_not_ready(self):
        rows = integrations.status({"integrations": {"providers": {}}})
        descript = next(row for row in rows if row["key"] == "descript")

        self.assertFalse(descript["enabled"])
        self.assertFalse(descript["ready"])

    def test_enabled_api_provider_uses_env_key(self):
        cfg = {"integrations": {"providers": {"descript": {"enabled": True}}}}
        env = dict(os.environ)
        env["DESCRIPT_API_TOKEN"] = "test-token"

        with patch.dict(os.environ, env, clear=True):
            rows = integrations.status(cfg)

        descript = next(row for row in rows if row["key"] == "descript")
        self.assertTrue(descript["enabled"])
        self.assertTrue(descript["configured"])
        self.assertTrue(descript["ready"])
        self.assertEqual(descript["detail"], "DESCRIPT_API_TOKEN")

    def test_enabled_provider_without_secret_needs_setup(self):
        cfg = {"integrations": {"providers": {"runway": {"enabled": True}}}}
        env = dict(os.environ)
        env.pop("RUNWAY_API_KEY", None)

        with patch.dict(os.environ, env, clear=True):
            rows = integrations.status(cfg)

        runway = next(row for row in rows if row["key"] == "runway")
        self.assertTrue(runway["enabled"])
        self.assertFalse(runway["ready"])
        self.assertIn("RUNWAY_API_KEY", runway["needs"])


if __name__ == "__main__":
    unittest.main()
