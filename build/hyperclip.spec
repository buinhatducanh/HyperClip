# build/hyperclip.spec
# PyInstaller spec for HyperClip PySide6 + Rust binary
# -*- mode: python ; coding: utf-8 -*-

import os
from PyInstaller.utils.hooks import collect_data_files

PROJECT_ROOT = os.path.abspath('..')

a = Analysis(
    [os.path.join(PROJECT_ROOT, 'src', 'main.py')],
    pathex=[PROJECT_ROOT],
    binaries=[
        (os.path.join(PROJECT_ROOT, 'target', 'release', 'hyperclip-tauri.exe'), '.'),
    ],
    hiddenimports=[
        'PySide6.QtCore',
        'PySide6.QtGui',
        'PySide6.QtQml',
        'PySide6.QtQuick',
        'PySide6.QtMultimedia',
        'PySide6.QtNetwork',
        'PySide6.QtWidgets',
    ],
    datas=[
        (os.path.join(PROJECT_ROOT, 'src', 'ui', 'qml'), 'qml'),
        (os.path.join(PROJECT_ROOT, 'resources'), 'resources'),
        (os.path.join(PROJECT_ROOT, 'node_modules'), 'node_modules'),
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=None,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=None)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='HyperClip',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    icon=os.path.join(PROJECT_ROOT, 'build', 'icon.ico'),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='hyperclip-bundle',
)
