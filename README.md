# defect-heatmap README

This extension allows you to visualize the areas of your code that are most often changed. The closer the color is to red, the more changes there were.

To use once installed, open the command palette, and enter `Generate heatmap`, or `Show heatmap report`.

#### Hotspot and overall file temperature report

![Hotspot heatmap](/images/hotspot_heatmap.png)

![Hottest files heatmap](/images/hottest_files_heatmap.png)

#### In-file overlay

![Heatmap overlay](/images/overlay.png)

(don't worry. it can be hidden with the `hide heatmap color overlay` command)

The process can take a while, so be patient. The more files it has to iterate through, the longer it will take, so use the settings to be sure you're only looking at the files you care about.

This extension uses the following `git` command to fetch the relevant commits for each line of each relevant file:

```shell
git log --no-patch --pretty="%h" -L ${lineNumber},${lineNumber}:${filePath}
```

If you want to add any extra args onto the end of that command, you can use the `defect-heatmap.extraGitArgs` option.

For example, if you set `defect-heatmap.extraGitArgs` to `-E --grep='^[^a-zA-Z]*fix:'`, then the command would become:

```shell
git log --no-patch --pretty="%h" -L ${lineNumber},${lineNumber}:${filePath} -E --grep='^[^a-zA-Z]*fix:'
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
git log --no-patch --pretty="%h" -L 1,${fileLineCount}:${filePath} -E --grep='^[^a-zA-Z]*fix:'
```

It's the same thing as the individual line command except that it's applying to the whole file.

The reason this is calculated as well as the individual line temps, is because a single file could have hundreds of changes inside it, while each line inside it only has a few. If a single file is the source for most changes, even if no line in particular has had many changes, that's still a red flag.

### How the matches are counted

Whether it's looking at an individual line, or the file as a whole, the default command arguments used (i.e. `--no-patch --prety-'%h'`) results in the shorthand hash of each relevant commit being provided on a new line. The function determining the temp is really only counting how many lines there are in the command output (after trimming whitespace). Specifically, it's doing this:

```typescript
return commandOutput.split('\n').length;
```

Note: for `countMatch` mode, it's doing this to determine the temperature:

```typescript
const re = new RegExp(<string>this.workspaceConfig.get('countMatch.pattern'), 'g');
return ((commandOutput || '').match(re) || []).length;
```

### Calculating line temp by number of text matches (rather than the number of matching commits)

Instead of relying on the number of commit messages that come up for a given line (given how the extension is configured) to determine how "hot" each line is, you may instead want to base it on the number of times a pattern is matched in the git log for each line.

This can be useful if you have things like octopus merges, where several commits were bundled together, and there's possibly multiple instances of a pattern in each commit message that you want to account for.

Note: in the event of an octopus merge, this tool won't be able to distinguish between the changes made by each individual commit that was part of the octopus merge, so be mindful when using this approach.

If you enable `defect-heatmap.countMatch.enable`, and set `defect-heatmap.countMatch.method` to `pattern matches`, then this extension will use this `git` command (instead of the one from above):

```shell
git log -L ${lineNumber},${lineNumber}:${filePath} ${extraGitArgs}
```

and the results will be parsed in JavaScript, where the pattern provided in `defect-heatmap.countMatch.pattern` will be used to count the matches.

So it will be up to you to make sure the formatting of the commit messages will jive with the match pattern you're using.

The `defect-heatmap.extraGitArgs` setting will still be used, giving you extra control over this though.

As an example, if you want to consider the following commit message as adding 2 to the line temperature:

```text
fix: listen to the correct event

- fix: don't do thing when not allowed
```

then you can set `defect-heatmap.extraGitArgs` to `--pretty=full --no-patch -E --grep='^[^a-zA-Z]*fix:'`, and `defect-heatmap.countMatch.pattern` to `^[^a-zA-Z]*fix:`.

### More advanced

If you want to use a more advanced means of determining a line's temperature, then one option is to leverage `defect-heatmap.extraGitArgs`, because whatever that's set to will be tacked on to the end of the command.

For example, if you want to match on the same lines as before, and you're on a system with `grep`, you could set `defect-heatmap.extraGitArgs` to `--pretty=full --no-patch | grep -E '^[^a-zA-Z]*fix:'`.

This extension uses `--no-patch --pretty='%h'` by default, but these can be overridden by passing a new `--pretty` option or `--patch` (or both, depending on what you want to override) to `defect-heatmap.extraGitArgs` (`git` will use the last one provided).

### Performance considerations

This extension isn't incredibily efficient, and can take a very long amount of time to build the heatmap cache. You can leverage these settings to come up with your own means of identifying problematic changes with reasonable performance.

## Requirements

The workspace that is opened, must also be the folder that contains the `.git` folder.

## Extension Settings

This extension contributes the following settings:

* `defect-heatmap.include.pattern`: glob pattern for files to match
* `defect-heatmap.exclude.enable`: enable/disable the exclude pattern (uses default excludes if disabled)
* `defect-heatmap.exclude.pattern`: glob pattern for excluding files/folders
* `defect-heatmap.extraGitArgs`: any extra args to pass to the git command for each line
* `defect-heatmap.countMatch.enable`: enable/disbale alternate method for determining line temp
* `defect-heatmap.countMatch.method`: base line temperature off of pattern matches, or line counts from command output
* `defect-heatmap.countMatch.pattern`: pattern to use if `defect-heatmap.countMatch.method` is set to `pattern matches`

## Known Issues

* No automated checks yet.
