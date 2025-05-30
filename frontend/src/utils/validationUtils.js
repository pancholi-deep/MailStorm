import { readFileAsText } from "./fileUtils";

const personalEmailDomains = [
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com",
  "live.com", "icloud.com", "aol.com", "mail.com",
];

function validateEmail(email) {
  email = email.toLowerCase();
  return personalEmailDomains.some((domain) => email.endsWith("@" + domain));
}

export async function validateCSVContent(file, readerFn = readFileAsText) {
  const text = await readerFn(file);
  const lines = text.trim().split(/\r?\n/);
  if (lines.length === 0) throw new Error("CSV file is empty");

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  if (!headers.includes("name") || !headers.includes("email")) {
    throw new Error("CSV must contain 'name' and 'email' columns");
  }

  const nameIndex = headers.indexOf("name");
  const emailIndex = headers.indexOf("email");

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const name = cols[nameIndex]?.trim() || "";
    const email = cols[emailIndex]?.trim() || "";
    if (name === "" || email === "") continue;
    if (!validateEmail(email)) {
      throw new Error(`Invalid personal email at row ${i + 1}: ${email}`);
    }
  }
}

export async function validateTemplateContent(file, readerFn = readFileAsText) {
  const text = await readerFn(file);
  const lower = text.toLowerCase();

  // Check if this looks like an HTML file by presence of <html> tag or <!DOCTYPE html>
  const isHtml = lower.includes("<html>") || lower.includes("<!doctype html>");

  if (!lower.includes("subject:") && !isHtml) {
    throw new Error("Template must contain a 'Subject:' line");
  }

  if (!lower.includes("body:") && !isHtml) {
    throw new Error("Template must contain a 'Body:' line");
  }
}

