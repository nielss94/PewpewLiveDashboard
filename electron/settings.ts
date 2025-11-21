import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export interface AppSettings {
	pollIntervalMs?: number;
}

const SETTINGS_FILE = 'settings.json';

function getSettingsPath(): string {
	const dir = app.getPath('userData');
	return path.join(dir, SETTINGS_FILE);
}

export async function loadSettings(): Promise<AppSettings> {
	try {
		const p = getSettingsPath();
		if (!fs.existsSync(p)) return {};
		const raw = await fs.promises.readFile(p, 'utf-8');
		return JSON.parse(raw) as AppSettings;
	} catch {
		return {};
	}
}

export async function saveSettings(s: AppSettings): Promise<void> {
	const p = getSettingsPath();
	try {
		await fs.promises.mkdir(path.dirname(p), { recursive: true });
		await fs.promises.writeFile(p, JSON.stringify(s, null, 2), 'utf-8');
	} catch {
		// ignore
	}
}

