"""Hermes plugin entry point.

Hermes' plugin loader (``hermes_cli/plugins.py``) requires every directory
plugin to expose a ``register(ctx)`` function directly on ``__init__.py`` —
it imports this file via ``importlib.util.spec_from_file_location`` with
``submodule_search_locations`` set to the plugin directory, then calls
``getattr(module, "register")``. Without this file the loader raises
``FileNotFoundError`` and silently skips the plugin.
"""
try:
    from .adapter import register
except ModuleNotFoundError:
    # adapter.py imports Hermes' own `gateway.*` package, which only exists
    # inside a real Hermes runtime. Degrade gracefully so this file stays
    # importable in other contexts (e.g. pytest collecting adapter/test/,
    # which walks through this package's __init__.py regardless of which
    # test module it's actually after).
    register = None  # type: ignore[assignment]

__all__ = ["register"]
