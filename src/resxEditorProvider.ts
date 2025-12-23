import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseString, Builder } from 'xml2js';

interface ResxEntry {
    name: string;
    value: string;
    comment?: string;
}

interface ResxDocument {
    [language: string]: Map<string, ResxEntry>;
}

export class ResxEditorProvider implements vscode.CustomTextEditorProvider {
    private escapeRegExp(input: string): string {
        return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private tryGetCultureFromResxFileName(baseFileName: string, fileName: string): string | null {
        // Matches: <base>.<culture>.resx where culture is BCP-47-ish, e.g. en-US, zh-Hans-CN, zh-hans-cn
        // Keep the original casing from the filename so we don't accidentally write a different file name on save.
        const escapedBase = this.escapeRegExp(baseFileName);
        const match = fileName.match(new RegExp(`^${escapedBase}\\.([A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})+)\\.resx$`, 'i'));
        return match ? match[1] : null;
    }

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new ResxEditorProvider(context);
        const providerRegistration = vscode.window.registerCustomEditorProvider(
            'resxEditor.editor',
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true,
                },
                supportsMultipleEditorsPerDocument: false,
            }
        );
        return providerRegistration;
    }

    constructor(private readonly context: vscode.ExtensionContext) {}

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
        };

        const updateWebview = async () => {
            const resxData = await this.loadResxFiles(document.uri);
            webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, resxData);
        };

        webviewPanel.webview.onDidReceiveMessage(
            async (message) => {
                try {
                    console.log('Received message:', message);
                    switch (message.type) {
                        case 'save':
                            await this.saveResxFiles(document.uri, message.data);
                            return;
                        case 'requestAddRow':
                            const key = await vscode.window.showInputBox({
                                prompt: 'Enter new key name',
                                placeHolder: 'e.g., WelcomeMessage',
                                validateInput: (value) => {
                                    if (!value || !value.trim()) {
                                        return 'Key name cannot be empty';
                                    }
                                    return null;
                                }
                            });
                            if (key) {
                                await this.addNewRow(document.uri, key.trim());
                                await updateWebview();
                                vscode.window.showInformationMessage(`Added new key: ${key}`);
                            }
                            return;
                        case 'requestDeleteRow':
                            const result = await vscode.window.showWarningMessage(
                                `Are you sure you want to delete key "${message.key}"?`,
                                { modal: true },
                                'Delete'
                            );
                            if (result === 'Delete') {
                                await this.deleteRow(document.uri, message.key);
                                await updateWebview();
                                vscode.window.showInformationMessage(`Deleted key: ${message.key}`);
                            }
                            return;
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Error: ${error}`);
                    console.error('Error handling message:', error);
                }
            }
        );

        await updateWebview();

        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                updateWebview();
            }
        });

        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });
    }

    private async loadResxFiles(baseUri: vscode.Uri): Promise<ResxDocument> {
        const basePath = baseUri.fsPath;
        const dir = path.dirname(basePath);
        const baseFileName = path.basename(basePath, '.resx');
        
        const resxFiles: ResxDocument = {};
        const files = fs.readdirSync(dir);
        
        // Load default file
        const defaultContent = await this.parseResxFile(basePath);
        resxFiles['default'] = defaultContent;

        // Load language-specific files
        for (const file of files) {
            const language = this.tryGetCultureFromResxFileName(baseFileName, file);
            if (language) {
                const filePath = path.join(dir, file);
                const content = await this.parseResxFile(filePath);
                resxFiles[language] = content;
            }
        }

        return resxFiles;
    }

    private async parseResxFile(filePath: string): Promise<Map<string, ResxEntry>> {
        const content = fs.readFileSync(filePath, 'utf-8');
        const entries = new Map<string, ResxEntry>();

        return new Promise((resolve, reject) => {
            parseString(content, (err, result) => {
                if (err) {
                    reject(err);
                    return;
                }

                if (result.root && result.root.data) {
                    for (const data of result.root.data) {
                        const name = data.$.name;
                        const value = data.value ? data.value[0] : '';
                        const comment = data.comment ? data.comment[0] : '';
                        entries.set(name, { name, value, comment });
                    }
                }

                resolve(entries);
            });
        });
    }

    private async saveResxFiles(baseUri: vscode.Uri, data: any): Promise<void> {
        const basePath = baseUri.fsPath;
        const dir = path.dirname(basePath);
        const baseFileName = path.basename(basePath, '.resx');

        for (const [language, entries] of Object.entries(data)) {
            let filePath: string;
            if (language === 'default') {
                filePath = basePath;
            } else {
                filePath = path.join(dir, `${baseFileName}.${language}.resx`);
            }

            await this.writeResxFile(filePath, entries as any);
        }

        vscode.window.showInformationMessage('Resx files saved successfully!');
    }

    private async writeResxFile(filePath: string, entries: Record<string, ResxEntry>): Promise<void> {
        const dataArray = Object.values(entries).map(entry => {
            const dataNode: any = {
                $: { name: entry.name, 'xml:space': 'preserve' },
                value: [entry.value]
            };
            if (entry.comment) {
                dataNode.comment = [entry.comment];
            }
            return dataNode;
        });

        const xmlObj = {
            root: {
                $: {
                    'xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
                    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance'
                },
                'xsd:schema': [{
                    $: { id: 'root', xmlns: '', 'xmlns:xsd': 'http://www.w3.org/2001/XMLSchema', 'xmlns:msdata': 'urn:schemas-microsoft-com:xml-msdata' },
                    'xsd:import': [{ $: { namespace: 'http://www.w3.org/XML/1998/namespace' } }],
                    'xsd:element': [{
                        $: { name: 'root', 'msdata:IsDataSet': 'true' },
                        'xsd:complexType': [{
                            'xsd:choice': [{
                                $: { maxOccurs: 'unbounded' },
                                'xsd:element': [{
                                    $: { name: 'metadata' },
                                    'xsd:complexType': [{
                                        'xsd:sequence': [{
                                            'xsd:element': [{ $: { name: 'value', type: 'xsd:string', minOccurs: '0' } }]
                                        }],
                                        'xsd:attribute': [
                                            { $: { name: 'name', use: 'required', type: 'xsd:string' } },
                                            { $: { name: 'type', type: 'xsd:string' } },
                                            { $: { name: 'mimetype', type: 'xsd:string' } },
                                            { $: { ref: 'xml:space' } }
                                        ]
                                    }]
                                }, {
                                    $: { name: 'assembly' },
                                    'xsd:complexType': [{
                                        'xsd:attribute': [{ $: { name: 'alias', type: 'xsd:string' } }, { $: { name: 'name', type: 'xsd:string' } }]
                                    }]
                                }, {
                                    $: { name: 'data' },
                                    'xsd:complexType': [{
                                        'xsd:sequence': [{
                                            'xsd:element': [{ $: { name: 'value', type: 'xsd:string', minOccurs: '0', 'msdata:Ordinal': '1' } }, { $: { name: 'comment', type: 'xsd:string', minOccurs: '0', 'msdata:Ordinal': '2' } }]
                                        }],
                                        'xsd:attribute': [
                                            { $: { name: 'name', type: 'xsd:string', use: 'required', 'msdata:Ordinal': '1' } },
                                            { $: { name: 'type', type: 'xsd:string', 'msdata:Ordinal': '3' } },
                                            { $: { name: 'mimetype', type: 'xsd:string', 'msdata:Ordinal': '4' } },
                                            { $: { ref: 'xml:space' } }
                                        ]
                                    }]
                                }, {
                                    $: { name: 'resheader' },
                                    'xsd:complexType': [{
                                        'xsd:sequence': [{ 'xsd:element': [{ $: { name: 'value', type: 'xsd:string', minOccurs: '0', 'msdata:Ordinal': '1' } }] }],
                                        'xsd:attribute': [{ $: { name: 'name', type: 'xsd:string', use: 'required' } }]
                                    }]
                                }]
                            }]
                        }]
                    }]
                }],
                resheader: [
                    { $: { name: 'resmimetype' }, value: ['text/microsoft-resx'] },
                    { $: { name: 'version' }, value: ['2.0'] },
                    { $: { name: 'reader' }, value: ['System.Resources.ResXResourceReader, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089'] },
                    { $: { name: 'writer' }, value: ['System.Resources.ResXResourceWriter, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089'] }
                ],
                data: dataArray
            }
        };

        const builder = new Builder({ xmldec: { version: '1.0', encoding: 'utf-8' } });
        const xml = builder.buildObject(xmlObj);
        fs.writeFileSync(filePath, xml, 'utf-8');
    }

    private async addNewRow(baseUri: vscode.Uri, key: string): Promise<void> {
        const basePath = baseUri.fsPath;
        const dir = path.dirname(basePath);
        const baseFileName = path.basename(basePath, '.resx');
        const files = fs.readdirSync(dir);

        // Add to default file
        await this.addKeyToFile(basePath, key);

        // Add to all language-specific files
        for (const file of files) {
            const language = this.tryGetCultureFromResxFileName(baseFileName, file);
            if (language) {
                const filePath = path.join(dir, file);
                await this.addKeyToFile(filePath, key);
            }
        }
    }

    private async addKeyToFile(filePath: string, key: string): Promise<void> {
        const content = fs.readFileSync(filePath, 'utf-8');
        
        return new Promise((resolve, reject) => {
            parseString(content, async (err, result) => {
                if (err) {
                    reject(err);
                    return;
                }

                if (!result.root.data) {
                    result.root.data = [];
                }

                // Check if key already exists
                const exists = result.root.data.some((data: any) => data.$.name === key);
                if (!exists) {
                    const newEntry = {
                        $: { name: key, 'xml:space': 'preserve' },
                        value: ['']
                    };
                    result.root.data.push(newEntry);

                    const builder = new Builder({ xmldec: { version: '1.0', encoding: 'utf-8' } });
                    const xml = builder.buildObject(result);
                    fs.writeFileSync(filePath, xml, 'utf-8');
                }

                resolve();
            });
        });
    }

    private async deleteRow(baseUri: vscode.Uri, key: string): Promise<void> {
        const basePath = baseUri.fsPath;
        const dir = path.dirname(basePath);
        const baseFileName = path.basename(basePath, '.resx');
        const files = fs.readdirSync(dir);

        const resxFiles = [basePath];
        for (const file of files) {
            const language = this.tryGetCultureFromResxFileName(baseFileName, file);
            if (language) {
                resxFiles.push(path.join(dir, file));
            }
        }

        for (const filePath of resxFiles) {
            const content = fs.readFileSync(filePath, 'utf-8');
            
            await new Promise<void>((resolve, reject) => {
                parseString(content, (err, result) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (result.root && result.root.data) {
                        result.root.data = result.root.data.filter((data: any) => data.$.name !== key);
                        
                        const builder = new Builder({ xmldec: { version: '1.0', encoding: 'utf-8' } });
                        const xml = builder.buildObject(result);
                        fs.writeFileSync(filePath, xml, 'utf-8');
                    }

                    resolve();
                });
            });
        }
    }

    private getHtmlForWebview(webview: vscode.Webview, resxData: ResxDocument): string {
        const languages = Object.keys(resxData);
        const allKeys = new Set<string>();
        
        for (const entries of Object.values(resxData)) {
            for (const key of entries.keys()) {
                allKeys.add(key);
            }
        }

        const rows = Array.from(allKeys).map(key => {
            const row: any = { key };
            for (const language of languages) {
                const entry = resxData[language]?.get(key);
                row[language] = entry?.value || '';
            }
            return row;
        });

        const escapeHtml = (str: string) => {
            return str
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        };

        const columnKeys = ['__key', ...languages, '__actions'];
        const defaultColumnWidths: Record<string, number> = {
            __key: 260,
            __actions: 90,
        };
        for (const lang of languages) {
            defaultColumnWidths[lang] = 320;
        }

        const colGroupHtml = columnKeys
            .map((colKey) => `<col data-col-key="${escapeHtml(colKey)}" style="width: ${(defaultColumnWidths[colKey] ?? 200)}px;" />`)
            .join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Resx Editor</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        .toolbar {
            margin-bottom: 20px;
            display: flex;
            gap: 10px;
        }
        button {
            padding: 6px 12px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            cursor: pointer;
            border-radius: 2px;
        }
        button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .grid-container {
            overflow-x: auto;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            background: var(--vscode-editor-background);
            table-layout: fixed;
        }
        th, td {
            border: 1px solid var(--vscode-panel-border);
            padding: 8px;
            text-align: left;
            overflow: hidden;
        }
        th {
            background: var(--vscode-editor-inactiveSelectionBackground);
            font-weight: 600;
            position: sticky;
            top: 0;
            z-index: 10;
        }
        th.resizable {
            position: relative;
        }
        .resize-handle {
            position: absolute;
            top: 0;
            right: 0;
            width: 8px;
            height: 100%;
            cursor: col-resize;
            user-select: none;
            touch-action: none;
        }
        .resize-handle:hover {
            background: var(--vscode-focusBorder);
        }
        input, textarea {
            width: 100%;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 4px;
            box-sizing: border-box;
        }
        input:focus, textarea:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        .key-cell {
            min-width: 0;
            max-width: none;
        }
        .value-cell {
            min-width: 0;
            max-width: none;
        }
        .delete-btn {
            background: var(--vscode-errorForeground);
            color: white;
            padding: 4px 8px;
            font-size: 12px;
        }
        .action-cell {
            text-align: center;
        }
        body.fit-mode .grid-container {
            overflow-x: hidden;
        }
        body.fit-mode .key-cell,
        body.fit-mode .value-cell {
            min-width: 0;
            max-width: none;
        }
        body.fit-mode textarea,
        body.fit-mode input {
            min-width: 0;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <button onclick="addRow()">Add New Key</button>
        <button id="fitColumnsBtn">Fit Columns</button>
        <button onclick="saveData()">Save All</button>
    </div>
    
    <div class="grid-container" id="gridContainer">
        <table id="resxTable">
            <colgroup>
                ${colGroupHtml}
            </colgroup>
            <thead>
                <tr>
                    <th class="resizable" data-col-key="__key">Key<div class="resize-handle" data-col-key="__key"></div></th>
                    ${languages.map(lang => `<th class="resizable" data-col-key="${escapeHtml(lang)}">${lang === 'default' ? 'Default' : escapeHtml(lang)}<div class="resize-handle" data-col-key="${escapeHtml(lang)}"></div></th>`).join('')}
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map(row => `
                    <tr data-key="${escapeHtml(row.key)}">
                        <td class="key-cell">
                            <input type="text" value="${escapeHtml(row.key)}" onchange="updateKey(this)" />
                        </td>
                        ${languages.map(lang => `
                            <td class="value-cell">
                                <textarea rows="2" onchange="updateValue(this, '${escapeHtml(row.key)}', '${escapeHtml(lang)}')">${escapeHtml(row[lang] || '')}</textarea>
                            </td>
                        `).join('')}
                        <td class="action-cell">
                            <button class="delete-btn" onclick="deleteRow('${escapeHtml(row.key)}')">Delete</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>

    <script>
        (function() {
            const vscode = acquireVsCodeApi();
            const persistedState = vscode.getState() || {};
            let data = ${JSON.stringify(resxData, (key, value) => 
                value instanceof Map ? Object.fromEntries(value) : value
            )};

            const columnKeys = ${JSON.stringify(columnKeys)};
            const defaultColumnWidths = ${JSON.stringify(defaultColumnWidths)};
            let columnWidths = persistedState.columnWidths || {};
            let fitMode = persistedState.fitMode || false;

            const colMap = {};
            const colEls = document.querySelectorAll('col[data-col-key]');
            for (const colEl of colEls) {
                const key = colEl.getAttribute('data-col-key');
                if (key) colMap[key] = colEl;
            }

            const getColElement = (colKey) => {
                return colMap[colKey] || null;
            };

            const applyFitModeClass = () => {
                document.body.classList.toggle('fit-mode', !!fitMode);
            };

            const applyColumnWidths = () => {
                for (const colKey of columnKeys) {
                    const colEl = getColElement(colKey);
                    if (!colEl) continue;
                    const widthSource = (columnWidths[colKey] !== undefined && columnWidths[colKey] !== null)
                        ? columnWidths[colKey]
                        : defaultColumnWidths[colKey];
                    const width = Number(widthSource);
                    if (Number.isFinite(width) && width > 0) {
                        colEl.style.width = String(width) + 'px';
                    }
                }
            };

            const persistLayout = () => {
                vscode.setState({
                    columnWidths,
                    fitMode
                });
            };

            const fitColumnsToWindow = () => {
                const container = document.getElementById('gridContainer');
                if (!container) return;

                const containerWidth = container.clientWidth;
                const languageCols = ${JSON.stringify(languages)};
                const actionWidth = Number((columnWidths.__actions !== undefined && columnWidths.__actions !== null)
                    ? columnWidths.__actions
                    : (defaultColumnWidths.__actions !== undefined && defaultColumnWidths.__actions !== null ? defaultColumnWidths.__actions : 90));
                const keyWidth = Math.min(
                    Math.max(
                        180,
                        Number((columnWidths.__key !== undefined && columnWidths.__key !== null)
                            ? columnWidths.__key
                            : (defaultColumnWidths.__key !== undefined && defaultColumnWidths.__key !== null ? defaultColumnWidths.__key : 260))
                    ),
                    420
                );

                // Account for borders/padding/scrollbar rounding so we reliably eliminate horizontal overflow.
                const overhead = 48;
                const available = Math.max(0, containerWidth - keyWidth - actionWidth - overhead);
                const perLang = Math.max(60, Math.floor(available / Math.max(1, languageCols.length)));

                const next = Object.assign({}, columnWidths, { __key: keyWidth, __actions: actionWidth });
                for (const lang of languageCols) {
                    next[lang] = perLang;
                }

                columnWidths = next;
                fitMode = true;
                applyFitModeClass();
                applyColumnWidths();
                persistLayout();

                console.log('[resx-editor] fitColumns applied', { containerWidth, keyWidth, actionWidth, perLang, columns: languageCols.length });
            };

            window.fitColumns = function() {
                fitColumnsToWindow();
            };

            const fitColumnsBtn = document.getElementById('fitColumnsBtn');
            if (fitColumnsBtn) {
                fitColumnsBtn.addEventListener('click', () => {
                    console.log('[resx-editor] fitColumns click');
                    fitColumnsToWindow();
                });
            }

            const installResizeHandles = () => {
                const handles = document.querySelectorAll('.resize-handle');
                for (const handle of handles) {
                    handle.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const colKey = handle.getAttribute('data-col-key');
                        if (!colKey) return;

                        console.log('[resx-editor] resize start', colKey);

                        // manual resize disables fit mode
                        fitMode = false;
                        applyFitModeClass();

                        const colEl = getColElement(colKey);
                        if (!colEl) {
                            console.warn('[resx-editor] resize: missing <col> for key', colKey, { known: Object.keys(colMap) });
                            return;
                        }

                        const startX = e.clientX;
                        const defaultWidth = (defaultColumnWidths[colKey] !== undefined && defaultColumnWidths[colKey] !== null) ? defaultColumnWidths[colKey] : 200;
                        const startWidth = Number.parseFloat(colEl.style.width || '0') || defaultWidth;
                        const minWidth = colKey === '__actions' ? 60 : 80;

                        document.body.style.userSelect = 'none';
                        document.body.style.cursor = 'col-resize';

                        const onMove = (moveEvent) => {
                            const delta = moveEvent.clientX - startX;
                            const nextWidth = Math.max(minWidth, Math.round(startWidth + delta));
                            columnWidths = Object.assign({}, columnWidths, { [colKey]: nextWidth });
                            colEl.style.width = String(nextWidth) + 'px';
                        };

                        const onUp = () => {
                            window.removeEventListener('mousemove', onMove);
                            window.removeEventListener('mouseup', onUp);
                            document.body.style.userSelect = '';
                            document.body.style.cursor = '';
                            persistLayout();
                        };

                        window.addEventListener('mousemove', onMove);
                        window.addEventListener('mouseup', onUp);
                    });
                }
            };

            // Initial layout
            applyFitModeClass();
            applyColumnWidths();
            installResizeHandles();

            console.log('[resx-editor] layout init', {
                colsInDom: colEls.length,
                handlesInDom: document.querySelectorAll('.resize-handle').length,
                knownColKeys: Object.keys(colMap)
            });

            window.addEventListener('resize', () => {
                if (fitMode) {
                    fitColumnsToWindow();
                }
            });

            window.updateValue = function(element, key, language) {
                if (!data[language]) {
                    data[language] = {};
                }
                if (!data[language][key]) {
                    data[language][key] = { name: key, value: '' };
                }
                data[language][key].value = element.value;
            };

            window.updateKey = function(element) {
                const oldKey = element.closest('tr').dataset.key;
                const newKey = element.value;
                
                if (oldKey !== newKey && newKey) {
                    const languages = Object.keys(data);
                    for (const lang of languages) {
                        if (data[lang][oldKey]) {
                            data[lang][newKey] = { ...data[lang][oldKey], name: newKey };
                            delete data[lang][oldKey];
                        }
                    }
                    element.closest('tr').dataset.key = newKey;
                }
            };

            window.addRow = function() {
                vscode.postMessage({
                    type: 'requestAddRow'
                });
            };

            window.deleteRow = function(key) {
                vscode.postMessage({
                    type: 'requestDeleteRow',
                    key: key
                });
            };

            window.saveData = function() {
                vscode.postMessage({
                    type: 'save',
                    data: data
                });
            };

            console.log('Resx Editor initialized');
        })();
    </script>
</body>
</html>`;
    }
}
