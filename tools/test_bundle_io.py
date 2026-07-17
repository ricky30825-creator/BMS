import json
import os
import tempfile
import unittest

from bundle_io import TEMPLATE_LINE_INDEX, backup, pack, unpack

MARKUP = '<html><body><div style="color:#6B7280">가 / 나</div></body></html>'


def make_fake_bundle(path):
    lines = ["<!DOCTYPE html>\n"] * TEMPLATE_LINE_INDEX
    lines.append(json.dumps(MARKUP) + "\n")
    lines.append("</html>\n")
    with open(path, "w", encoding="utf-8") as f:
        f.writelines(lines)


class TestBundleIO(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.bundle = os.path.join(self.dir, "b.html")
        make_fake_bundle(self.bundle)

    def test_unpack_returns_markup(self):
        self.assertEqual(unpack(self.bundle), MARKUP)

    def test_roundtrip_is_identity(self):
        pack(self.bundle, unpack(self.bundle))
        self.assertEqual(unpack(self.bundle), MARKUP)

    def test_pack_preserves_other_lines(self):
        with open(self.bundle, encoding="utf-8") as f:
            before = f.readlines()
        pack(self.bundle, "<html>새</html>")
        with open(self.bundle, encoding="utf-8") as f:
            after = f.readlines()
        self.assertEqual(len(before), len(after))
        self.assertEqual(before[0], after[0])
        self.assertEqual(before[-1], after[-1])
        self.assertEqual(unpack(self.bundle), "<html>새</html>")

    def test_pack_rejects_non_ascii_escape_corruption(self):
        pack(self.bundle, MARKUP)
        with open(self.bundle, encoding="utf-8") as f:
            line = f.readlines()[TEMPLATE_LINE_INDEX]
        self.assertEqual(json.loads(line.strip()), MARKUP)

    def test_backup_creates_copy(self):
        dest = backup(self.bundle)
        self.assertTrue(os.path.exists(dest))
        with open(dest, encoding="utf-8") as f:
            self.assertEqual(json.loads(f.readlines()[TEMPLATE_LINE_INDEX].strip()), MARKUP)


if __name__ == "__main__":
    unittest.main()
