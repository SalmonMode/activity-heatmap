# defect-heatmap README

This extension allows you to visualize the areas of your code that are most often changed. The closer the color is to red, the more changes there were.

To use once installed, open the command palette, and enter `Generate heatmap`.

The process can take a while, so be patient. The more files it has to iterate through, the longer it will take, so use the settings to be sure you're only looking at the files you care about.

This extension uses the following `git` command to fetch the relevant commits for each line of each relevant file:

```shell
git log --no-patch -L ${lineNumber},${lineNumber}:${filePath} --pretty="%h"
```

If you want to add any extra args onto the end of that command, you can use the `defect-heatmap.extraGitArgs` option.

For example, if you set `defect-heatmap.extraGitArgs` to `-E --grep='^[^a-zA-Z]*fix:'`, then the command would become:

```shell
git log --no-patch -L ${lineNumber},${lineNumber}:${filePath} --pretty="%h" -E --grep='^[^a-zA-Z]*fix:'
```

and it would only match commits that have messages that have lines starting with `fix:` or something similar (this is a pattern based on [Angular's commit message guidelines](https://github.com/angular/angular/blob/master/CONTRIBUTING.md)). Here's some commit messages it would match on:

```text
fix: don't do the thing
```

```text
feat: add button to do the thing

* fix: don't do thing when not allowed
```

```text
feat: add button to do the thing

- fix: don't do thing when not allowed
```

When calculating individual file temperatures overall, those arguments will also be used, and it will look something like this:

```shell
git log --no-patch --pretty="%h" -E --grep='^[^a-zA-Z]*fix:' ${filePath}
```

## Requirements

The workspace that is opened, must also be the folder that contains the `.git` folder.

## Extension Settings

This extension contributes the following settings:

* `defect-heatmap.include.pattern`: glob pattern for files to match
* `defect-heatmap.exclude.enable`: enable/disable the exclude pattern (uses default excludes if disabled)
* `defect-heatmap.exclude.pattern`: glob pattern for excluding files/folders
* `defect-heatmap.extraGitArgs`: any extra args to pass to the git command for each line

## Known Issues

* No automated checks yet.
