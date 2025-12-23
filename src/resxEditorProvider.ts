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

type UiLanguage = 'en' | 'zh-cn';

type UiStringKey =
    | 'addNewKey'
    | 'fitColumns'
    | 'saveAll'
    | 'key'
    | 'default'
    | 'actions'
    | 'uiLanguage'
    | 'uiLanguageAuto'
    | 'uiLanguageEn'
    | 'uiLanguageZhCn'
    | 'enterNewKeyPrompt'
    | 'enterNewKeyPlaceholder'
    | 'keyCannotBeEmpty'
    | 'addedNewKey'
    | 'confirmDeleteKey'
    | 'delete'
    | 'deletedKey'
    | 'savedSuccessfully';

const UI_STRINGS: Record<UiLanguage, Record<UiStringKey, string>> = {
    en: {
        addNewKey: 'Add New Key',
        fitColumns: 'Fit Columns',
        saveAll: 'Save All',
        key: 'Key',
        default: 'Default',
        actions: 'Actions',
        uiLanguage: 'UI Language',
        uiLanguageAuto: 'Auto (VS Code)',
        uiLanguageEn: 'English',
        uiLanguageZhCn: '简体中文',
        enterNewKeyPrompt: 'Enter new key name',
        enterNewKeyPlaceholder: 'e.g., WelcomeMessage',
        keyCannotBeEmpty: 'Key name cannot be empty',
        addedNewKey: 'Added new key: {key}',
        confirmDeleteKey: 'Are you sure you want to delete key "{key}"?',
        delete: 'Delete',
        deletedKey: 'Deleted key: {key}',
        savedSuccessfully: 'Resx files saved successfully!'
    },
    'zh-cn': {
        addNewKey: '新增 Key',
        fitColumns: '适配列宽',
        saveAll: '保存全部',
        key: 'Key',
        default: '默认',
        actions: '操作',
        uiLanguage: '界面语言',
        uiLanguageAuto: '自动（跟随 VS Code）',
        uiLanguageEn: 'English',
        uiLanguageZhCn: '简体中文',
        enterNewKeyPrompt: '请输入新 Key 名称',
        enterNewKeyPlaceholder: '例如：WelcomeMessage',
        keyCannotBeEmpty: 'Key 名称不能为空',
        addedNewKey: '已新增 Key：{key}',
        confirmDeleteKey: '确定要删除 Key “{key}” 吗？',
        delete: '删除',
        deletedKey: '已删除 Key：{key}',
        savedSuccessfully: 'Resx 文件已保存！'
    }
};

export class ResxEditorProvider implements vscode.CustomTextEditorProvider {
    private resolveUiLanguage(): UiLanguage {
        const configured = vscode.workspace.getConfiguration().get<string>('resxEditor.uiLanguage', 'auto');
        const raw = (configured === 'auto' ? vscode.env.language : configured).toLowerCase();

        // Treat all zh-* (including zh-hans/zh-hant) as Simplified Chinese for now.
        if (raw.startsWith('zh')) {
            return 'zh-cn';
        }
        return 'en';
    }

    private t(lang: UiLanguage, key: UiStringKey, vars?: Record<string, string>): string {
        let text = UI_STRINGS[lang][key] ?? UI_STRINGS.en[key] ?? key;
        if (vars) {
            for (const [k, v] of Object.entries(vars)) {
                const token = `{${k}}`;
                text = text.split(token).join(v);
            }
        }
        return text;
    }

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
            const uiLanguage = this.resolveUiLanguage();
            webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, resxData);
            // Note: uiLanguage is embedded into HTML via getHtmlForWebview; re-render updates UI.
        };

        webviewPanel.webview.onDidReceiveMessage(
            async (message) => {
                try {
                    console.log('Received message:', message);
                    switch (message.type) {
                        case 'save':
                            await this.saveResxFiles(document.uri, message.data);
                            return;
                        case 'setUiLanguage': {
                            const value = String(message.value ?? 'auto');
                            const allowed = new Set(['auto', 'en', 'zh-cn']);
                            const next = allowed.has(value) ? value : 'auto';
                            await vscode.workspace.getConfiguration().update(
                                'resxEditor.uiLanguage',
                                next,
                                vscode.ConfigurationTarget.Global
                            );
                            await updateWebview();
                            return;
                        }
                        case 'requestAddRow':
                            const uiLanguage = this.resolveUiLanguage();
                            const key = await vscode.window.showInputBox({
                                prompt: this.t(uiLanguage, 'enterNewKeyPrompt'),
                                placeHolder: this.t(uiLanguage, 'enterNewKeyPlaceholder'),
                                validateInput: (value) => {
                                    if (!value || !value.trim()) {
                                        return this.t(uiLanguage, 'keyCannotBeEmpty');
                                    }
                                    return null;
                                }
                            });
                            if (key) {
                                await this.addNewRow(document.uri, key.trim());
                                await updateWebview();
                                vscode.window.showInformationMessage(this.t(uiLanguage, 'addedNewKey', { key }));
                            }
                            return;
                        case 'requestDeleteRow':
                            const uiLanguageDelete = this.resolveUiLanguage();
                            const result = await vscode.window.showWarningMessage(
                                this.t(uiLanguageDelete, 'confirmDeleteKey', { key: String(message.key) }),
                                { modal: true },
                                this.t(uiLanguageDelete, 'delete')
                            );
                            if (result === this.t(uiLanguageDelete, 'delete')) {
                                await this.deleteRow(document.uri, message.key);
                                await updateWebview();
                                vscode.window.showInformationMessage(this.t(uiLanguageDelete, 'deletedKey', { key: String(message.key) }));
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

        const configSubscription = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('resxEditor.uiLanguage')) {
                updateWebview();
            }
        });

        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                updateWebview();
            }
        });

        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
            configSubscription.dispose();
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

        const uiLanguage = this.resolveUiLanguage();
        vscode.window.showInformationMessage(this.t(uiLanguage, 'savedSuccessfully'));
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
        const uiLanguage = this.resolveUiLanguage();
        const s = (key: UiStringKey) => this.t(uiLanguage, key);
        const uiLanguageSetting = vscode.workspace.getConfiguration().get<string>('resxEditor.uiLanguage', 'auto');
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
            align-items: center;
            flex-wrap: wrap;
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
        .toolbar-spacer {
            flex: 1;
        }
        .toolbar-setting {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-left: auto;
        }
        .toolbar-setting label {
            opacity: 0.9;
        }
        .toolbar-setting select {
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 4px 8px;
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
        <button onclick="addRow()">${escapeHtml(s('addNewKey'))}</button>
        <button id="fitColumnsBtn">${escapeHtml(s('fitColumns'))}</button>
        <button onclick="saveData()">${escapeHtml(s('saveAll'))}</button>

        <span class="toolbar-spacer"></span>
        <div class="toolbar-setting">
            <label for="uiLanguageSelect">${escapeHtml(s('uiLanguage'))}</label>
            <select id="uiLanguageSelect">
                <option value="auto">${escapeHtml(s('uiLanguageAuto'))}</option>
                <option value="en">${escapeHtml(s('uiLanguageEn'))}</option>
                <option value="zh-cn">${escapeHtml(s('uiLanguageZhCn'))}</option>
            </select>
        </div>
    </div>
    
    <div class="grid-container" id="gridContainer">
        <table id="resxTable">
            <colgroup>
                ${colGroupHtml}
            </colgroup>
            <thead>
                <tr>
                    <th class="resizable" data-col-key="__key">${escapeHtml(s('key'))}<div class="resize-handle" data-col-key="__key"></div></th>
                    ${languages.map(lang => `<th class="resizable" data-col-key="${escapeHtml(lang)}">${lang === 'default' ? escapeHtml(s('default')) : escapeHtml(lang)}<div class="resize-handle" data-col-key="${escapeHtml(lang)}"></div></th>`).join('')}
                    <th>${escapeHtml(s('actions'))}</th>
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
                            <button class="delete-btn" onclick="deleteRow('${escapeHtml(row.key)}')">${escapeHtml(s('delete'))}</button>
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
            const uiLanguageSetting = ${JSON.stringify(uiLanguageSetting)};
            let data = ${JSON.stringify(resxData, (key, value) => 
                value instanceof Map ? Object.fromEntries(value) : value
            )};

            const columnKeys = ${JSON.stringify(columnKeys)};
            const defaultColumnWidths = ${JSON.stringify(defaultColumnWidths)};
            let columnWidths = persistedState.columnWidths || {};
            let fitMode = (typeof persistedState.fitMode === 'boolean') ? persistedState.fitMode : true;

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
            };

            window.fitColumns = function() {
                fitColumnsToWindow();
            };

            const fitColumnsBtn = document.getElementById('fitColumnsBtn');
            if (fitColumnsBtn) {
                fitColumnsBtn.addEventListener('click', () => {
                    fitColumnsToWindow();
                });
            }

            const uiLanguageSelect = document.getElementById('uiLanguageSelect');
            if (uiLanguageSelect) {
                uiLanguageSelect.value = uiLanguageSetting;
                uiLanguageSelect.addEventListener('change', () => {
                    vscode.postMessage({
                        type: 'setUiLanguage',
                        value: uiLanguageSelect.value
                    });
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

                        // manual resize disables fit mode
                        fitMode = false;
                        applyFitModeClass();

                        const colEl = getColElement(colKey);
                        if (!colEl) {
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

            // Default to Fit Columns on first open; if user manually resizes, fitMode is turned off.
            if (fitMode) {
                fitColumnsToWindow();
            }

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
