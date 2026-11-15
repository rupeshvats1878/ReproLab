import sys
import unittest
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from appearance import measure


class AppearanceTests(unittest.TestCase):
    def test_uniform_and_striped_software_fixture(self):
        uniform = np.full((32, 32, 3), 100, dtype=np.uint8)
        striped = uniform.copy()
        striped[:, 16:] = [20, 180, 220]
        first = measure(uniform, [0, 0, 32, 32], "RED", "synthetic", 100)
        second = measure(striped, [0, 0, 32, 32], "RED", "synthetic", 100)
        self.assertAlmostEqual(first["metricValue"], 0, places=3)
        self.assertGreater(second["metricValue"], first["metricValue"])
        self.assertEqual(second["label"], "unclear")
        self.assertEqual(second["cupId"], "RED")

    def test_outside_roi_ignored(self):
        image = np.full((32, 32, 3), 100, dtype=np.uint8)
        first = measure(image, [0, 0, 16, 16], "BLUE", "synthetic", 0)
        image[16:, :] = 255
        second = measure(image, [0, 0, 16, 16], "BLUE", "synthetic", 0)
        self.assertEqual(first, second)

    def test_invalid_roi(self):
        image = np.zeros((32, 32, 3), dtype=np.uint8)
        for roi in ([0, 0, 33, 32], [-1, 0, 16, 16], [0, 0, 7, 7], [0., 0, 16, 16]):
            with self.assertRaises(ValueError):
                measure(image, roi, "BLUE", "synthetic", 0)

    def test_invalid_time(self):
        with self.assertRaises(ValueError):
            measure(np.zeros((8, 8, 3), dtype=np.uint8), [0, 0, 8, 8],
                    "GREEN", "synthetic", float("nan"))


if __name__ == "__main__":
    unittest.main()
