"""Exercise installation in a temporary HOME; never modify the real desktop."""
import gettext
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
UUID = "tray-fold@kelvin"


class InstallTests(unittest.TestCase):
    def test_invalid_catalog_does_not_change_existing_installation(self):
        with tempfile.TemporaryDirectory(prefix="tray-fold-invalid-catalog-") as temp:
            root = Path(temp)
            checkout = root / "checkout"
            checkout.mkdir()
            shutil.copy2(ROOT / "install.sh", checkout / "install.sh")
            shutil.copytree(ROOT / UUID, checkout / UUID)
            (checkout / UUID / "po/zh_CN.po").write_text('msgid "unterminated\n')
            home = root / "home"
            target = home / ".local/share/cinnamon/applets" / UUID
            target.mkdir(parents=True)
            (target / "applet.js").write_text("previous version")
            locale = home / ".local/share/locale/zh_CN/LC_MESSAGES" / (UUID + ".mo")
            locale.parent.mkdir(parents=True)
            locale.write_bytes(b"previous translation")
            result = subprocess.run(["bash", str(checkout / "install.sh")],
                                    env={**os.environ, "HOME": str(home)}, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual((target / "applet.js").read_text(), "previous version")
            self.assertEqual(locale.read_bytes(), b"previous translation")

    def test_install_update_translate_and_uninstall(self):
        with tempfile.TemporaryDirectory(prefix="tray-fold-install-") as temp:
            home = Path(temp) / "home with spaces"
            home.mkdir()
            env = {**os.environ, "HOME": str(home)}
            target = home / ".local/share/cinnamon/applets" / UUID
            other = target.parent / "other@demo" / "keep.txt"
            other.parent.mkdir(parents=True)
            other.write_text("keep")
            settings = home / ".config/cinnamon/spices" / UUID / "saved.json"
            settings.parent.mkdir(parents=True)
            settings.write_text('{"keep": true}')
            other_locale = home / ".local/share/locale/zh_CN/LC_MESSAGES/other.mo"
            other_locale.parent.mkdir(parents=True)
            other_locale.write_bytes(b"keep")

            def run(script):
                subprocess.run(["bash", str(ROOT / script)], env=env, check=True, capture_output=True, text=True)

            run("install.sh")
            self.assertEqual((target / "applet.js").read_bytes(), (ROOT / UUID / "applet.js").read_bytes())
            self.assertEqual((target / "LICENSE").read_bytes(), (ROOT / "LICENSE").read_bytes())
            self.assertTrue((target / "NOTICE").is_file())
            translator = gettext.translation(UUID, str(home / ".local/share/locale"), languages=["zh_CN"])
            self.assertEqual(translator.gettext("Tray Fold"), "托盘折叠")
            self.assertEqual(translator.gettext("General"), "常规")
            self.assertEqual(translator.gettext("legacy"), "旧式")
            (target / "obsolete.js").write_text("stale")
            run("install.sh")
            self.assertFalse((target / "obsolete.js").exists())
            run("uninstall.sh")
            run("uninstall.sh")  # safe to repeat
            self.assertFalse(target.exists())
            self.assertFalse((other_locale.parent / (UUID + ".mo")).exists())
            self.assertEqual(other.read_text(), "keep")
            self.assertEqual(other_locale.read_bytes(), b"keep")
            self.assertEqual(settings.read_text(), '{"keep": true}')


if __name__ == "__main__":
    unittest.main()
