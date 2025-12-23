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
        }
        th, td {
            border: 1px solid var(--vscode-panel-border);
            padding: 8px;
            text-align: left;
        }
        th {
            background: var(--vscode-editor-inactiveSelectionBackground);
            font-weight: 600;
            position: sticky;
            top: 0;
            z-index: 10;
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
            min-width: 200px;
            max-width: 300px;
        }
        .value-cell {
            min-width: 250px;
            max-width: 400px;
        }
        .delete-btn {
            background: var(--vscode-errorForeground);
            color: white;
            padding: 4px 8px;
            font-size: 12px;
        }
        .action-cell {
            width: 80px;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <button onclick="addRow()">Add New Key</button>
        <button onclick="saveData()">Save All</button>
    </div>
    
    <div class="grid-container">
        <table id="resxTable">
            <thead>
                <tr>
                    <th>Key</th>
                    ${languages.map(lang => `<th>${lang === 'default' ? 'Default' : lang}</th>`).join('')}
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
            let data = ${JSON.stringify(resxData, (key, value) => 
                value instanceof Map ? Object.fromEntries(value) : value
            )};

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
