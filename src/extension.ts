// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { execSync } from 'child_process';


export function activate(context: vscode.ExtensionContext) {

	const heatmapManager = new HeatmapManager(context);

	let disposable = vscode.commands.registerCommand('defect-heatmap.generate', () => {
		heatmapManager.generateHeatmap();
		vscode.window.onDidChangeVisibleTextEditors(() => {
			heatmapManager.renderHeatmapForVisibleTextEditors();
		});
	});

	context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {}

type Filename = string;

interface FileHeatmap {
	hash: string | Int32Array;
	temps: number[];
	hottest: number;
}

interface FileHeatmapFull {
	filePath: string;
	hash: string | Int32Array;
	temps: number[];
	hottest: number;
}

type RepoHeatmap = Map<Filename, FileHeatmap>;


class HeatmapManager {
	context: vscode.ExtensionContext;
	cache: any | undefined;
	private waitingOnCache: Promise<void>;
	private gitWatcher: vscode.FileSystemWatcher;
	processing: boolean;
	_gitIndex: vscode.Uri;
	private colorDecorations: vscode.TextEditorDecorationType[];
	private workspaceConfig: vscode.WorkspaceConfiguration;
    constructor(context: vscode.ExtensionContext) {
		this.workspaceConfig = vscode.workspace.getConfiguration('defect-heatmap');
		this.context = context;
		this.cache = undefined;
		this.waitingOnCache = this.initializeCache();
		this.processing = false;
		this._gitIndex = this._getGitIndex();
		this.gitWatcher = this.initializeGitWatcher();
		this.colorDecorations = <vscode.TextEditorDecorationType[]>[];
	}
	_getGitIndex(): vscode.Uri {
		const rootUri = vscode.Uri.file(vscode.workspace.rootPath!);
		return vscode.Uri.joinPath(rootUri, '.git', 'index');
	}
	get gitIndex(): vscode.Uri {
		return this._gitIndex;
	}
	async initializeCache(): Promise<void> {
		let tempCache: any | undefined = this.context.workspaceState.get('defectHeatmap');
		if (!tempCache) {
			await this.context.workspaceState.update('defectHeatmap', {});
			tempCache = this.context.workspaceState.get<any>('defectHeatmap');
		}
		this.cache = tempCache;
		if (!('temps' in this.cache)) {
			this.cache.temps = new Map() as RepoHeatmap;
		}
		if (!('hottestToCoolest' in this.cache!)) {
			this.cache.hottestToCoolest = <FileHeatmapFull[]>[];
		}
	}
	initializeGitWatcher(): vscode.FileSystemWatcher {
		const gitWatcher = vscode.workspace.createFileSystemWatcher('**/.git/index');
		const self = this;
		gitWatcher.onDidChange((uri: vscode.Uri) => {
			self.generateHeatmap();
		});
		return gitWatcher;
	}
	async generateHeatmap() {
		if (this.processing) {
			return;
		}
		this.processing = true;
		const [collectedFiles, totalLines] = await this.collectFiles();
		await this.buildHeatmapCacheForCollectedFiles(collectedFiles, totalLines);
		this.buildHottestToCoolest();
		if (this.cache.hottestToCoolest <= 0) {
			vscode.window.showWarningMessage('Couldn\'t gather sufficient data to generate a heatmap with current settings. File matching settings or extra git command args may be too strict.');
			this.wipeOutDecorations();
			this.processing = false;
			return;
		}
		await this.renderHeatmapForVisibleTextEditors();
		this.processing = false;
	}
	async collectFiles(): Promise<[[vscode.TextDocument, string | Int32Array][], number]> {
		await this.waitingOnCache;
		const include: string = <string>this.workspaceConfig.get('include');
		const exclude: string | undefined | null = this.workspaceConfig.get('enableExclude') ? (this.workspaceConfig.get('exclude') || null): undefined;
		const files = await vscode.workspace.findFiles(include, exclude);
		const filesThatNeedToBeUpdated: [vscode.TextDocument, string | Int32Array][] = [];
		const self = this;
		let totalLines = 0;

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "Collecting files for heatmap",
			cancellable: true
		}, async function (progress, token) {
			token.onCancellationRequested(() => {
				console.log("User canceled heatmap generation");
			});
			progress.report({ increment: 0 });
			await new Promise(r => setTimeout(r, 0));

			const incrementPerFile = 100 / files.length;

			for (let file of files) {
				let filePath: string = file.fsPath;
				progress.report({ increment: incrementPerFile, message: filePath });
				await new Promise(r => setTimeout(r, 0));
				if (!self.fileIsTrackedByGit(filePath)) {
					continue;
				}
				let fileDetails: vscode.TextDocument;
				try {
					fileDetails = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
				}
				catch (error) {
					console.log(`Error while opening file (${filePath}): ${error.message}`);
					continue;
				}
				if (fileDetails.lineCount === 1) {
					continue;
				}
				const fileHash = self.getHashForFile(fileDetails);
				if (!self.fileNeedsToBeUpdated(filePath, fileHash)) {
					// doesn't need to be processed
					continue;
				}
				totalLines += fileDetails.lineCount;
				filesThatNeedToBeUpdated.push([fileDetails, fileHash]);
			}
		});
		return [filesThatNeedToBeUpdated, totalLines];
	}
	fileIsTrackedByGit(filePath: string): boolean {
		try {
			execSync(`git ls-files --error-unmatch ${filePath}`, {cwd: vscode.workspace.rootPath!});
		} catch (error) {
			// must not be tracked
			return false;
		}
		return true;
	}
	getHashForFile(fileDetails: vscode.TextDocument): string {
		return execSync(`git hash-object ${fileDetails.uri.fsPath}`, {cwd: vscode.workspace.rootPath!}).toString();
	}
	fileNeedsToBeUpdated(filePath: string, fileHash: string | Int32Array): boolean {
		if (this.cache!.temps!.has() && this.cache!.temps!.get(filePath)?.hash === fileHash) {
			// doesn't need to be processed
			return false;
		}
		return true;
	}
	get heatmapCacheProgressOptions(): vscode.ProgressOptions {
		return {
			location: vscode.ProgressLocation.Notification,
			title: "Generating heatmap",
			cancellable: true
		};
	}
	async buildHeatmapCacheForCollectedFiles(filesThatNeedToBeUpdated: [vscode.TextDocument, string | Int32Array][], totalLines: number) {
		if (filesThatNeedToBeUpdated.length === 0) {
			// nothing to process
			return;
		}
		const self = this;
		await vscode.window.withProgress(this.heatmapCacheProgressOptions, async (progress, token) => {
			token.onCancellationRequested(() => {
				console.log("User canceled heatmap generation");
			});
			progress.report({ increment: 0});
			await new Promise(r => setTimeout(r, 0));

			const incrementPerLine = 100 / totalLines;

			for (let [fileDetails, fileHash] of filesThatNeedToBeUpdated) {
				await self.cacheHeatmapForFile(fileDetails, fileHash, progress, incrementPerLine);
			}
		});
	}
	async cacheHeatmapForFile(fileDetails: vscode.TextDocument, fileHash: string | Int32Array, progress: vscode.Progress<{
		message?: string;
		increment?: number;
	}>, incrementPerLine: number) {
		const heatmap: RepoHeatmap = this.cache!.temps;
		const filePath = fileDetails.uri.fsPath;
		let heatCounts: number[] = [];
		for (let lineNumber = 1; lineNumber < fileDetails.lineCount; lineNumber++) {
			progress.report({ increment: incrementPerLine, message: `${filePath}:${lineNumber}` });
			await new Promise(r => setTimeout(r, 0));
			let logCount = this.getGitLogCountForLineOfFile(filePath, lineNumber);
			heatCounts.push(logCount);
		}
		const hottest = Math.max(...heatCounts);
		heatmap.set(filePath, {hash: fileHash, temps: heatCounts, hottest: hottest});

	}
	getGitLogCountForLineOfFile(filePath: string, lineNumber: number): number {
		const extraGitArgs: string = <string>this.workspaceConfig.get('extraGitArgs');
		const command = `git log --no-patch -L ${lineNumber},${lineNumber}:${filePath} --pretty="%h" ${extraGitArgs}`;
		const logs = execSync(command, {cwd: vscode.workspace.rootPath!}).toString();
		// logs have trailing new line, even when there's only one relevant
		// commit, so reduce the number by one for the true count.
		return logs.split('\n').length - 1;
	}
	buildHottestToCoolest() {
		// reset the array so that stale values aren't factored in
		this.cache!.hottestToCoolest = <FileHeatmapFull[]>[];
		const self = this;
		if (this.cache!.temps.size === 0) {
			return;
		}
		this.cache!.temps.forEach((value: FileHeatmap, key: string, map: RepoHeatmap) => {
			self.cache.hottestToCoolest.push({filePath: key, ...value});
		});
		this.cache.hottestToCoolest.sort((fileA: FileHeatmapFull, fileB: FileHeatmapFull) => fileB.hottest - fileA.hottest);
	}
	async renderHeatmapForVisibleTextEditors() {
		this.wipeOutDecorations();
		const maxTemp: number = this.cache!.hottestToCoolest[0]!.hottest!;
		const heatmap: RepoHeatmap = this.cache!.temps!;
		for (let textEditor of vscode.window.visibleTextEditors){
			if (!heatmap.has(textEditor.document.uri.fsPath)) {
				continue;
			}
			let temps = heatmap.get(textEditor.document.uri.fsPath)!.temps;
			for (let lineNumber = 0; lineNumber < temps.length; lineNumber++){
				let range = textEditor.document.lineAt(lineNumber).range;
				let lineColor = this.getColorFromTemperaturePercent(temps[lineNumber] / maxTemp);
				let decType = vscode.window.createTextEditorDecorationType({isWholeLine: true, backgroundColor: `rgba(${Math.floor(255*lineColor.red)},${Math.floor(255*lineColor.green)},${Math.floor(255*lineColor.blue)},${lineColor.alpha})`});
				this.colorDecorations.push(decType);
				textEditor.setDecorations(decType, [range]);
			}
		}
	}
	getColorFromTemperaturePercent(tempPercent: number): vscode.Color {
		let red: number = 0;
		let green: number = 0;
		let blue: number = 0;
		if (tempPercent > 0.2) {
			let adjustedPercent = ((tempPercent - 0.2) / 0.8);
			blue = 0;
			[red, green] = adjustedPercent < 0.5 ? [adjustedPercent, 1] : [1, adjustedPercent];
		} else if (tempPercent < 0.2) {
			let adjustedPercent = tempPercent / 0.2;
			red = 0;
			[green, blue] = adjustedPercent < 0.5 ? [adjustedPercent, 1] : [1, adjustedPercent];
		} else if (tempPercent === 0.2) {
			[red, green, blue] = [0, 1, 0];
		} else {
			throw Error(`Invalid tempPercent: ${tempPercent}`);
		}
		return new vscode.Color(red, green, blue, 0.5);
	}
	wipeOutDecorations() {
		while (this.colorDecorations.length > 0){
			this.colorDecorations.pop()!.dispose();
		}
	}
}
