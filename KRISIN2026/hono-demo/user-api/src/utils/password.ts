// 生成随机盐值
function generateSalt(): string {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

// 用 SHA-256 对字符串做哈希
async function sha256(message: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);
    return Array.from(hashArray, b => b.toString(16).padStart(2, '0')).join('');
}

// 哈希密码：生成盐，把「盐+密码」做 SHA-256，用 : 拼起来存
export async function hashPassword(password: string): Promise<string> {
    const salt = generateSalt();
    const hash = await sha256(salt + password);
    return `${salt}:${hash}`;
}

// 验证密码：从存储的字符串里取出盐，对输入做同样的哈希，比较结果
export async function verifyPassword(
    password: string,
    stored: string,
): Promise<boolean> {
    const [salt, hash] = stored.split(':');
    const inputHash = await sha256(salt + password);
    return inputHash === hash;
}
