# Change Log

All notable changes to the "defect-heatmap" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [1.3.1] - 2020-10-09

### Added

- Pics to README

## [1.3.0] - 2020-10-09

### Added

- Method to count temp by number of custom pattern matches

## [1.2.1] - 2020-10-09

### Changed

- Configuration setting namespaces for better grouping

## [1.2.0] - 2020-10-08

### Added

- Command to hide heatmap overlay
- "Defect Heatmap:" prefix on commands in command palette

## [1.1.0] - 2020-10-08

### Added

- Repo details in manifest

### Fixed

- Recheck files before displaying report in case the heatmap needs to be rebuilt
- Filter out unmatched files from heatmap report
- Add non-null assertion

## [1.0.0] - 2020-10-08

### Added

- Extra git command args for getting logs for each line of each relevant file
- Create report for hottest files/lines

### Fixed

- Don't try to render heatmap decorations when no commits were found
- Skip files that aren't tracked by git

## [0.0.1] - 2020-10-07

- Initial releas
