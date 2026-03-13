import fs from 'fs';
import path from 'path';
import os from 'os';
import { OrderlyConfig, DEFAULT_CONFIG } from '../types.js';

const CONFIG_DIR = '.orderly-cli';
const CONFIG_FILE = 'config.json';

function getConfigPath(): string {
  return path.join(os.homedir(), CONFIG_DIR, CONFIG_FILE);
}

function getConfigDir(): string {
  return path.join(os.homedir(), CONFIG_DIR);
}

export function loadConfig(): OrderlyConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }
  const data = fs.readFileSync(configPath, 'utf-8');
  return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
}

export function saveConfig(config: OrderlyConfig): void {
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function setDefaultAccount(accountId: string): void {
  const config = loadConfig();
  config.defaultAccountId = accountId;
  saveConfig(config);
}

export function getDefaultAccount(): string | undefined {
  return loadConfig().defaultAccountId;
}

export function clearDefaultAccount(): void {
  const config = loadConfig();
  delete config.defaultAccountId;
  saveConfig(config);
}
