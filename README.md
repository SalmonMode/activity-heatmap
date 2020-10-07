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
* Doesn't handle uncommitted changes

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

-----------------------------------------------------------------------------------------------------------

## Working with Markdown

**Note:** You can author your README using Visual Studio Code.  Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux)
* Toggle preview (`Shift+CMD+V` on macOS or `Shift+Ctrl+V` on Windows and Linux)
* Press `Ctrl+Space` (Windows, Linux) or `Cmd+Space` (macOS) to see a list of Markdown snippets

### For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
