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
                switch (message.type) {
                    case 'save':
                        await this.saveResxFiles(document.uri, message.data);
                        return;
                    case 'addRow':
                        await this.addNewRow(document.uri, message.key);
                        await updateWebview();
                        return;
                    case 'deleteRow':
                        await this.deleteRow(document.uri, message.key);
                        await updateWebview();
                        return;
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
            const match = file.match(new RegExp(`^${baseFileName}\\.([a-zA-Z]{2}-[a-zA-Z]{2})\\.resx$`));
            if (match) {
                const language = match[1];
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
        // Implementation for adding new row
    }

    private async deleteRow(baseUri: vscode.Uri, key: string): Promise<void> {
        // Implementation for deleting row
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
                    <tr data-key="${row.key}">
                        <td class="key-cell">
                            <input type="text" value="${row.key}" onchange="updateKey(this)" />
                        </td>
                        ${languages.map(lang => `
                            <td class="value-cell">
                                <textarea rows="2" onchange="updateValue(this, '${row.key}', '${lang}')">${row[lang] || ''}</textarea>
                            </td>
                        `).join('')}
                        <td class="action-cell">
                            <button class="delete-btn" onclick="deleteRow('${row.key}')">Delete</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let data = ${JSON.stringify(resxData, (key, value) => 
            value instanceof Map ? Object.fromEntries(value) : value
        )};

        function updateValue(element, key, language) {
            if (!data[language]) {
                data[language] = {};
            }
            if (!data[language][key]) {
                data[language][key] = { name: key, value: '' };
            }
            data[language][key].value = element.value;
        }

        function updateKey(element) {
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
        }

        function addRow() {
            const key = prompt('Enter new key name:');
            if (key && key.trim()) {
                vscode.postMessage({
                    type: 'addRow',
                    key: key.trim()
                });
            }
        }

        function deleteRow(key) {
            if (confirm(\`Are you sure you want to delete key "\${key}"?\`)) {
                vscode.postMessage({
                    type: 'deleteRow',
                    key: key
                });
            }
        }

        function saveData() {
            vscode.postMessage({
                type: 'save',
                data: data
            });
        }
    </script>
</body>
</html>`;
    }
}
