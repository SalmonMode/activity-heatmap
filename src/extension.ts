// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { execSync } from 'child_process';


export function activate(context: vscode.ExtensionContext) {

	const heatmapManager = new HeatmapManager(context);

	let generateHeatmapDisposable = vscode.commands.registerCommand('defect-heatmap.generate', () => {
		heatmapManager.generateHeatmap();
		vscode.window.onDidChangeVisibleTextEditors(() => {
			heatmapManager.renderHeatmapForVisibleTextEditors();
		});
	});

	context.subscriptions.push(generateHeatmapDisposable);

	let showHeatmapReportDisposable = vscode.commands.registerCommand('defect-heatmap.showReport', () => {
		displayHeatmapReport(context, heatmapManager);
	});

	context.subscriptions.push(showHeatmapReportDisposable);
}

// this method is called when your extension is deactivated
export function deactivate() {}

type Filename = string;

interface FileHeatmap {
	hash: string | Int32Array;
	temps: number[];
	hottest: number;
	hottestLineIndex: number;
	overall: number;
}

interface FileHeatmapFull {
	filePath: string;
	hash: string | Int32Array;
	temps: number[];
	hottest: number;
	hottestLineIndex: number;
	overall: number;
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
	initialHeatmapCacheBuilt: boolean;
    constructor(context: vscode.ExtensionContext) {
		this.context = context;
		this.cache = undefined;
		this.waitingOnCache = this.initializeCache();
		this.processing = false;
		this._gitIndex = this._getGitIndex();
		this.gitWatcher = this.initializeGitWatcher();
		this.colorDecorations = <vscode.TextEditorDecorationType[]>[];
		this.initialHeatmapCacheBuilt = false;
	}
	get workspaceConfig(): vscode.WorkspaceConfiguration {
		return vscode.workspace.getConfiguration('defect-heatmap');
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
		if (!('hottestToCoolestHotspots' in this.cache!)) {
			this.cache.hottestToCoolestHotspots = <FileHeatmapFull[]>[];
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
		this.buildHottestToCoolestHotspots();
		if (this.cache.hottestToCoolestHotspots <= 0) {
			vscode.window.showWarningMessage('Couldn\'t gather sufficient data to generate a heatmap with current settings. File matching settings or extra git command args may be too strict.');
			this.wipeOutDecorations();
			this.processing = false;
			return;
		}
		this.buildHottestToCoolestOverall();
		await this.renderHeatmapForVisibleTextEditors();
		this.initialHeatmapCacheBuilt = true;
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
		if (this.cache!.temps!.has(filePath) && this.cache!.temps!.get(filePath)?.hash === fileHash) {
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
		const fileTemperature = this.getGitLogCountForEntireFile(filePath);
		heatmap.set(filePath, {hash: fileHash, temps: heatCounts, hottest: hottest, hottestLineIndex: heatCounts.indexOf(hottest) + 1, overall: fileTemperature});

	}
	getGitLogCountForLineOfFile(filePath: string, lineNumber: number): number {
		const extraGitArgs: string = <string>this.workspaceConfig.get('extraGitArgs');
		const command = `git log --no-patch -L ${lineNumber},${lineNumber}:${filePath} --pretty="%h" ${extraGitArgs}`;
		const logs = execSync(command, {cwd: vscode.workspace.rootPath!}).toString();
		// logs have trailing new line, even when there's only one relevant
		// commit, so reduce the number by one for the true count.
		return logs.split('\n').length - 1;
	}
	getGitLogCountForEntireFile(filePath: string): number {
		const extraGitArgs: string = <string>this.workspaceConfig.get('extraGitArgs');
		const command = `git log --no-patch --pretty="%h" ${extraGitArgs} ${filePath}`;
		const logs = execSync(command, {cwd: vscode.workspace.rootPath!}).toString();
		// logs have trailing new line, even when there's only one relevant
		// commit, so reduce the number by one for the true count.
		return logs.split('\n').length - 1;
	}
	buildHottestToCoolestHotspots() {
		// reset the array so that stale values aren't factored in
		this.cache!.hottestToCoolestHotspots = <FileHeatmapFull[]>[];
		const self = this;
		if (this.cache!.temps.size === 0) {
			return;
		}
		this.cache!.temps.forEach((value: FileHeatmap, key: string, map: RepoHeatmap) => {
			self.cache.hottestToCoolestHotspots.push({filePath: key, ...value});
		});
		this.cache.hottestToCoolestHotspots.sort((fileA: FileHeatmapFull, fileB: FileHeatmapFull) => fileB.hottest - fileA.hottest);
	}
	buildHottestToCoolestOverall() {
		// reset the array so that stale values aren't factored in
		this.cache!.hottestToCoolestOverall = <FileHeatmapFull[]>[];
		const self = this;
		if (this.cache!.temps.size === 0) {
			return;
		}
		this.cache!.temps.forEach((value: FileHeatmap, key: string, map: RepoHeatmap) => {
			self.cache.hottestToCoolestOverall.push({filePath: key, ...value});
		});
		this.cache.hottestToCoolestOverall.sort((fileA: FileHeatmapFull, fileB: FileHeatmapFull) => fileB.overall - fileA.overall);
	}
	async renderHeatmapForVisibleTextEditors() {
		this.wipeOutDecorations();
		// maxTemp should be based on the most changed line, rather than most changed file
		// so the colors make it easier to identify where the problems are. If the most
		// changed file was changed 200 times, but the most changed line was only changed 30
		// times, and maxTemp was based off of the most changed file, then all the lines
		// would be close to blue, making it more difficult to find where the problems are
		// visually. But if based off of the most changed line, then lines changed 30 times
		// would appear red.
		const maxTemp: number = this.cache!.hottestToCoolestHotspots[0]!.hottest!;
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
			[red, green] = adjustedPercent < 0.5 ? [1 - adjustedPercent, 1] : [1, 1 - adjustedPercent];
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


async function displayHeatmapReport(context: vscode.ExtensionContext, heatmapManager: HeatmapManager) {
	await heatmapManager.generateHeatmap();
	if (!heatmapManager.initialHeatmapCacheBuilt) {
		return;
	}
	const cache: any = context.workspaceState.get('defectHeatmap');
	const rootPathLength = vscode.workspace.rootPath!.length + 1;
	// Distinguish between max line temp and max file temp here, so that the colors for overall
	// file temps don't look closer to blue than they should be.
	const maxLineTemp = cache.hottestToCoolestHotspots[0].hottest;
	const maxFileTemp = cache.hottestToCoolestOverall[0].overall;
	const lineTempTrows = cache.hottestToCoolestHotspots.map( (file: FileHeatmapFull) => {
		const color = heatmapManager.getColorFromTemperaturePercent(file.hottest / maxLineTemp);
		const backgroundColor = `rgba(${color.red * 100}%, ${color.green * 100}%, ${color.blue * 100}%, ${color.alpha * 100}%)`;
		const relativeFilePath = file.filePath.slice(rootPathLength);
		return `<tr><td style="background-color: ${backgroundColor}"></td><td>${relativeFilePath}:${file.hottestLineIndex}</td><td>${file.hottest}</td></tr>`;
	});
	const fileTempTrows = cache.hottestToCoolestOverall.map( (file: FileHeatmapFull) => {
		const color = heatmapManager.getColorFromTemperaturePercent(file.overall / maxFileTemp);
		const backgroundColor = `rgba(${color.red * 100}%, ${color.green * 100}%, ${color.blue * 100}%, ${color.alpha * 100}%)`;
		const relativeFilePath = file.filePath.slice(rootPathLength);
		return `<tr><td style="background-color: ${backgroundColor}"></td><td>${relativeFilePath}</td><td>${file.overall}</td></tr>`;
	});
	const html = `
	<!doctype html>
	<html lang=en>
	<head>
	<meta charset=utf-8>
	<style>
	td {
		min-width:20px;
	}
	</style>
	<title>Heatmap report</title>
	</head>
	<body>
	<h1>Heatmap</h1>
	<h3>Sorted from hottest to coldest</h3>
	<h2>Hottest hotspots</h2>
	<table>
		<thead>
			<th></th>
			<th>File path</th>
			<th>Temperature</th>
		<thead/>
		<tbody>
			${lineTempTrows.join("")}
		</tbody>
	</table>
	<h2>Hottest files</h2>
	<table>
		<thead>
			<th></th>
			<th>File path</th>
			<th>Temperature</th>
		<thead/>
		<tbody>
			${fileTempTrows.join("")}
		</tbody>
	</table>
	`;
	const panel = vscode.window.createWebviewPanel('html', 'Heatmap report', vscode.ViewColumn.Active);
	panel.webview.html = html;
;}