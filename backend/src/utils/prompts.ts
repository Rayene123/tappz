import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROMPTS_DIR = path.join(__dirname, "../../prompts");

/**
 * Loads a prompt template from the prompts/ directory.
 * Supports simple {{variable}} interpolation.
 */
export function loadPrompt(
  name: string,
  vars: Record<string, string> = {}
): string {
  const filePath = path.join(PROMPTS_DIR, `${name}.txt`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Prompt file not found: ${filePath}`);
  }

  let template = fs.readFileSync(filePath, "utf-8");

  for (const [key, value] of Object.entries(vars)) {
    template = template.replaceAll(`{{${key}}}`, value);
  }

  return template;
}