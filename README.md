# defect-heatmap README

This extension allows you to visualize the areas of your code that are most often changed. The closer the color is to red, the more changes there were.

To use once installed, open the command palette, and enter `Generate heatmap`.

The process can take a while, so be patient. The more files it has to iterate through, the longer it will take, so use the settings to be sure you're only looking at the files you care about.

## Requirements

The workspace that is opened, must also be the folder that contains the `.git` folder.

## Extension Settings

This extension contributes the following settings:

* `defect-heatmap.include`: glob pattern for files to match
* `defect-heatmap.enableExclude`: enable/disable the exclude pattern (uses default excludes if disabled)
* `defect-heatmap.exclude`: glob pattern for excluding files/folders

## Known Issues

* Doesn't limit commit matches by patterns yet.
* No automated checks yet.
