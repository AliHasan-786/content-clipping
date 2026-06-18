from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline import auth


CLIENT_SECRET = {
    "installed": {
        "client_id": "client-id.apps.googleusercontent.com",
        "client_secret": "secret",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
    }
}


class AuthHelperTests(unittest.TestCase):
    def test_resolve_path_defaults_to_clipper_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with patch.object(auth, "ROOT", root):
                self.assertEqual(auth.resolve_path("secrets/token.json", "x"), root / "secrets/token.json")

    def test_validate_youtube_client_secret(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "client.json"
            path.write_text(auth.json.dumps(CLIENT_SECRET))

            ok, reason = auth.validate_youtube_client_secret(path)

        self.assertTrue(ok)
        self.assertEqual(reason, "ok")

    def test_update_env_preserves_comments_and_replaces_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            env_path.write_text("# comment\nA=old\n\nB=keep\n")
            with patch.object(auth, "ENV_PATH", env_path), patch.dict(os.environ, {}, clear=True):
                auth.update_env({"A": "new", "C": "added"})

            text = env_path.read_text()

        self.assertIn("# comment", text)
        self.assertIn("A=new", text)
        self.assertIn("B=keep", text)
        self.assertIn("C=added", text)

    def test_install_youtube_secret_copies_and_sets_defaults(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            source = base / "downloaded.json"
            source.write_text(auth.json.dumps(CLIENT_SECRET))
            env_path = base / ".env"
            secrets = base / "secrets"
            with patch.object(auth, "ENV_PATH", env_path):
                with patch.object(auth, "SECRETS", secrets):
                    with patch.dict(os.environ, {}, clear=True):
                        dest = auth.install_youtube_client_secret(str(source))

            self.assertEqual(dest, secrets / "yt_client_secret.json")
            self.assertTrue(dest.exists())
            self.assertIn("YT_CLIENT_SECRETS_FILE=secrets/yt_client_secret.json", env_path.read_text())


if __name__ == "__main__":
    unittest.main()
