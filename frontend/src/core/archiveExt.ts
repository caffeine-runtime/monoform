// Archive extensions, kept apart so the module registry can use them without
// loading the archive integration.
/** Packages and disk images we can browse: our own readers (deb, rpm, iso,
 * msi) and the many formats that are zip files under another name. */
export const PACKAGE_EXT = ['deb', 'udeb', 'rpm', 'iso', 'msi', 'jar', 'war', 'ear', 'aar', 'apk', 'xapk', 'apks', 'ipa', 'xpi', 'vsix', 'nupkg', 'whl', 'appx', 'msix', 'appxbundle', 'msixbundle'];
export const ARCHIVE_EXT = ['zip', 'tar', 'gz', 'tgz', 'tar.gz', 'tar.bz2', 'tbz2', 'tar.xz', 'txz', 'tar.zst', 'bz2', 'xz', 'zst', '7z', 'rar', ...PACKAGE_EXT];
