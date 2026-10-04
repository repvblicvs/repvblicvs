"""Regression checks for staged versus worktree disclosure."""
import importlib.util
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

CHECK = Path(__file__).resolve().parents[1] / "ops/public_check.py"
spec = importlib.util.spec_from_file_location("public_check", CHECK)
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class PublicationBoundary(unittest.TestCase):
    def test_redacted_report_filename_is_blocked(self):
        self.assertIn("private operating report filename", checker.issues(
            "repvblicvs-acquisition-" + "update.md", "Redacted\n"))

    def test_renamed_report_heading_is_blocked(self):
        self.assertIn("private operating report", checker.issues(
            "notes.md", "# Repvblicvs acquisition " + "status — private\nRedacted\n"))

    def test_private_report_is_not_public_prose(self):
        content = "# Session-Retro" + "spective\nInternal operating notes\n"
        self.assertIn("internal session report", checker.issues("notes.md", content))

    def test_clean_worktree_does_not_hide_staged_disclosure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "ops").mkdir()
            shutil.copy2(CHECK, root / "ops/public_check.py")
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            document = root / "notes.md"
            document.write_text("# Team-Direc" + "tion\nPrivate coordination\n")
            subprocess.run(["git", "add", "notes.md"], cwd=root, check=True)
            document.write_text("Public documentation\n")
            result = subprocess.run(["python3", "ops/public_check.py", "--staged"], cwd=root, capture_output=True)
            self.assertEqual(result.returncode, 1)


if __name__ == "__main__":
    unittest.main()
