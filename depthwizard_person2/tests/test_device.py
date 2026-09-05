"""Portable device selection without requiring GPU hardware or torch wheels."""
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.depth_model import select_device


@pytest.mark.parametrize('requested,available,expected', [
    ('cpu', True, 'cpu'), ('cpu', False, 'cpu'), ('auto', False, 'cpu'),
    ('auto', True, 'cuda'), ('cuda', True, 'cuda'),
])
def test_device_selection(monkeypatch, requested, available, expected):
    monkeypatch.setenv('DEPTH_DEVICE', requested)
    monkeypatch.setitem(sys.modules, 'torch', SimpleNamespace(
        device=lambda name: name, cuda=SimpleNamespace(is_available=lambda: available)))
    assert select_device() == expected


def test_explicit_unavailable_cuda_has_actionable_error(monkeypatch):
    monkeypatch.setenv('DEPTH_DEVICE', 'cuda')
    monkeypatch.setitem(sys.modules, 'torch', SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False)))
    with pytest.raises(RuntimeError, match='DEPTH_DEVICE=cpu'):
        select_device()
