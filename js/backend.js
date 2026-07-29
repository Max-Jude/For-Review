/**
 * ============================================================================
 * DE WISDOM COMPREHENSIVE ACADEMY - BACKEND ENGINE (backend.js)
 * ============================================================================
 * 
 * This backend script is designed to run in both environments:
 * 1. Google Apps Script (GAS) Web App connected to Google Sheets.
 * 2. Standalone Client / Browser runtime with integrated LocalStorage persistence.
 * 
 * EXPOSED ENDPOINTS & ACTIONS:
 * - "login"          : Authenticate Staff or Student users with SHA-256 password hashing.
 * - "submitAdmission": Submit new student admission applications into database.
 * - "getDashboard"   : Retrieve authorized dashboard data based on active session token.
 * - "manageUser"     : Admin feature to add or register new Staff or Student accounts.
 * ============================================================================
 */

// ================= CONFIG =================
const SHEETS = {
  staff: "Staff",
  students: "Students",
  admission: "Admission"
};

const SESSION_DURATION = 3600; // 1 hour token expiration in seconds

// Optional external Google Apps Script Web App URL (if deployed)
let GOOGLE_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyMsePdj3f61sdfNUkVnmeCVtEkkRN3Pn6VUQPvPVQrVeRYpBWtUapSLSiZTG4MOgWd/exec"; 

// Secret Admin Token matching Code.gs configuration
const ADMIN_SECRET_TOKEN = "DWE_ADMIN_SECURE_TOKEN_2026_982347";

// ================= MAIN ENTRY =================
/**
 * Primary HTTP POST handler for Google Apps Script Web App API
 * @param {Object} e - Event object containing postData
 */
function doPost(e) {
  try {
    const data = (typeof e.postData.contents === "string") 
      ? JSON.parse(e.postData.contents) 
      : e.postData.contents;

    const action = data.action;

    switch (action) {
      case "login":
        return respond(loginUser(data));

      case "submitAdmission":
        return respond(submitAdmission(data));

      case "getDashboard":
      case "fetchSystemData":
        return respond(getDashboard(data));

      case "manageUser":
      case "addUser":
      case "updateUser":
      case "deleteUser":
        return respond(manageUser(data));

      default:
        return respond({ status: "error", message: "Invalid action" });
    }
  } catch (err) {
    return respond({ status: "error", message: err.toString() });
  }
}

// ================= RESPONSE FORMAT =================
/**
 * Formats JSON response object for Google Apps Script or direct JS caller
 */
function respond(obj) {
  if (typeof ContentService !== "undefined" && ContentService.createTextOutput) {
    return ContentService
      .createTextOutput(JSON.stringify(obj))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return obj;
}

// ================= SECURITY & SESSIONS =================
/**
 * SHA-256 Hashing for secure user passwords
 */
function hashPassword(password) {
  if (!password) return "";
  
  // Google Apps Script environment
  if (typeof Utilities !== "undefined" && Utilities.computeDigest) {
    const raw = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256, password
    );
    return raw.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
  }

  // Web Browser / JS Runtime fallback (JS SHA-256 implementation)
  return jsSHA256(password);
}

/**
 * Creates an authenticated session token
 */
function createSession(username, role) {
  const token = (typeof Utilities !== "undefined" && Utilities.getUuid) 
    ? Utilities.getUuid() 
    : generateUUID();

  const sessionData = JSON.stringify({ username, role, createdAt: Date.now() });

  if (typeof CacheService !== "undefined" && CacheService.getScriptCache) {
    CacheService.getScriptCache().put(token, sessionData, SESSION_DURATION);
  } else {
    localSessionStore.set(token, sessionData);
  }

  return token;
}

/**
 * Verifies active session token
 */
function verifySession(token) {
  if (!token) return null;

  let sessionString = null;

  if (typeof CacheService !== "undefined" && CacheService.getScriptCache) {
    sessionString = CacheService.getScriptCache().get(token);
  } else {
    sessionString = localSessionStore.get(token);
  }

  if (!sessionString) return null;

  try {
    return JSON.parse(sessionString);
  } catch (e) {
    return null;
  }
}

// ================= LOGIN =================
/**
 * Authenticates user against Staff or Student database
 */
function loginUser(data) {
  const { username, password } = data;
  if (!username || !password) {
    return { status: "error", message: "Username and password required" };
  }

  const uClean = username.toString().trim();
  const pClean = password.toString().trim();

  // Admin login check
  if (uClean.toLowerCase() === "admin" && (pClean === "admin123" || hashPassword(pClean).toLowerCase() === hashPassword("admin123").toLowerCase())) {
    const token = createSession("admin", "admin");
    return {
      status: "success",
      role: "admin",
      token,
      name: "System Admin",
      detail: "Administrator",
      adminToken: ADMIN_SECRET_TOKEN
    };
  }

  const hashed = hashPassword(pClean);

  // 1. Check Staff Database
  let user = findUser(SHEETS.staff, uClean, hashed);
  if (user) {
    const token = createSession(uClean, "staff");
    return { 
      status: "success", 
      role: "staff", 
      token, 
      name: user.Name || user.name || uClean,
      detail: user.Detail || user.detail || "Faculty Staff"
    };
  }

  // 2. Check Students Database
  user = findUser(SHEETS.students, uClean, hashed);
  if (user) {
    const token = createSession(uClean, "student");
    return { 
      status: "success", 
      role: "student", 
      token, 
      name: user.Name || user.name || uClean,
      detail: user.Detail || user.detail || "Enrolled Student",
      studentStatus: user.Status || user.status || "active"
    };
  }

  return { status: "error", message: "Invalid username or password" };
}

// ================= FIND USER =================
/**
 * Helper to look up user in spreadsheet or local storage table
 */
function findUser(sheetName, username, password) {
  const sheet = getSheet(sheetName);
  const data = sheet.getDataRange().getValues();

  if (!data || data.length === 0) return null;

  const headers = data[0];
  const rows = data.slice(1);

  const uIndex = headers.indexOf("Username");
  const pIndex = headers.indexOf("Password");

  if (uIndex === -1 || pIndex === -1) return null;

  const targetU = username.toString().toLowerCase().trim();
  const targetP = password.toString().toLowerCase().trim();

  for (let row of rows) {
    if (!row || !row[uIndex] || !row[pIndex]) continue;
    
    const rowUser = row[uIndex].toString().toLowerCase().trim();
    const rowPass = row[pIndex].toString().toLowerCase().trim();

    if (rowUser === targetU && rowPass === targetP) {
      let obj = {};
      headers.forEach((h, i) => obj[h] = row[i]);
      return obj;
    }
  }
  return null;
}

// ================= ADMISSION =================
/**
 * Submits a new student admission application
 */
function submitAdmission(data) {
  const sheet = getSheet(SHEETS.admission);
  
  const submissionDate = new Date().toLocaleString();
  const name = data.name || data.fullName || "N/A";
  const age = data.age || "N/A";
  const gender = data.gender || "N/A";
  const classApplied = data.classApplied || data.classLevel || data.course || "N/A";
  const phone = data.phone || data.whatsapp || "N/A";
  const dob = data.dob || data.dateOfBirth || "N/A";
  const guardian = data.guardian || "N/A";
  const prevSchool = data.prevSchool || data.previousSchool || "N/A";
  const medical = data.medical || data.medicalConditions || "None";

  sheet.appendRow([
    submissionDate,
    name,
    age,
    gender,
    classApplied,
    phone,
    dob,
    guardian,
    prevSchool,
    medical
  ]);

  return { status: "success", message: "Admission submitted successfully" };
}

// ================= DASHBOARD =================
/**
 * Fetches authorized dashboard payload according to session role
 */
function getDashboard(data) {
  const session = verifySession(data.token);
  if (!session) return { status: "error", message: "Unauthorized" };

  if (session.role === "staff") {
    return {
      status: "success",
      data: {
        admissions: getAllData(SHEETS.admission),
        students: getAllData(SHEETS.students),
        staff: getAllData(SHEETS.staff)
      }
    };
  }

  if (session.role === "student") {
    return {
      status: "success",
      data: {
        message: "Welcome student",
        username: session.username
      }
    };
  }

  return { status: "error", message: "Invalid role" };
}

// ================= GET ALL DATA =================
/**
 * Reads all rows from specified table as array of objects
 */
function getAllData(sheetName) {
  const sheet = getSheet(sheetName);
  const data = sheet.getDataRange().getValues();

  if (!data || data.length <= 1) return [];

  const headers = data[0];
  const rows = data.slice(1);

  return rows.map(row => {
    let obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

// ================= ADMIN MANAGEMENT =================
/**
 * Registers or modifies Staff or Student user in database
 */
function manageUser(data) {
  const session = verifySession(data.token);
  if (!session || session.role !== "staff") {
    return { status: "error", message: "Unauthorized - Admin rights required" };
  }

  const { operation, userType, userData } = data;
  const sheetName = userType === "staff" ? SHEETS.staff : SHEETS.students;
  const sheet = getSheet(sheetName);

  if (operation === "add") {
    const hashedPass = hashPassword(userData.password || "password123");
    
    sheet.appendRow([
      userData.username,
      hashedPass,
      userType,
      userData.name,
      userData.detail || "Member",
      userData.status || "active"
    ]);

    return { status: "success", message: `User ${userData.name} registered successfully` };
  }

  if (operation === "edit" || operation === "update") {
    return updateUserInSheet(sheet, userData);
  }

  return { status: "error", message: "Invalid operation" };
}

/**
 * Updates an existing user record in sheet / database including password
 */
function updateUserInSheet(sheet, userData) {
  // Mock sheet environment
  if (sheet && typeof sheet.updateUser === "function") {
    sheet.updateUser(userData.username, userData);
    return { status: "success", message: `User ${userData.name || userData.username} updated successfully` };
  }

  // Google Apps Script environment
  if (sheet && typeof sheet.getDataRange === "function") {
    const data = sheet.getDataRange().getValues();
    if (!data || data.length <= 1) return { status: "error", message: "User not found" };

    const headers = data[0];
    const uIndex = headers.indexOf("Username");
    const pIndex = headers.indexOf("Password");
    const nIndex = headers.indexOf("Name");
    const dIndex = headers.indexOf("Detail");
    const sIndex = headers.indexOf("Status");

    for (let i = 1; i < data.length; i++) {
      if (data[i][uIndex] === userData.username) {
        if (userData.password && pIndex !== -1) {
          sheet.getRange(i + 1, pIndex + 1).setValue(hashPassword(userData.password));
        }
        if (userData.name && nIndex !== -1) {
          sheet.getRange(i + 1, nIndex + 1).setValue(userData.name);
        }
        if (userData.detail && dIndex !== -1) {
          sheet.getRange(i + 1, dIndex + 1).setValue(userData.detail);
        }
        if (userData.status && sIndex !== -1) {
          sheet.getRange(i + 1, sIndex + 1).setValue(userData.status);
        }
        return { status: "success", message: `User ${userData.name || userData.username} updated successfully` };
      }
    }
  }

  return { status: "error", message: "User not found" };
}


// ============================================================================
// STANDALONE ENVIRONMENT MOCKING & RUNTIME BRIDGE
// Enables local testing, offline usage, and seamless integration with index.html
// ============================================================================

/**
 * Accesses Google Apps Script Spreadsheet or LocalStorage Mock
 */
function getSheet(sheetName) {
  // Real Google Apps Script Environment
  if (typeof SpreadsheetApp !== "undefined" && SpreadsheetApp.getActiveSpreadsheet) {
    return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  }

  // Browser LocalStorage Persistence Engine
  return new LocalStorageSheetMock(sheetName);
}

/**
 * In-browser Spreadsheet Mock Engine
 */
class LocalStorageSheetMock {
  constructor(name) {
    this.name = name;
    this.storageKey = `dewisdom_sheet_${name}`;
    this.initDefaultData();
  }

  initDefaultData() {
    if (localStorage.getItem(this.storageKey)) return;

    let initialRows = [];

    if (this.name === SHEETS.staff) {
      initialRows = [
        ["Username", "Password", "Role", "Name", "Detail", "Status"],
        ["TCH-008", hashPassword("staffpass123"), "staff", "Dr. Jonathan Vance", "Senior Biology Teacher & Form Master", "active"],
        ["TCH-002", hashPassword("staffpass123"), "staff", "Mrs. Sarah Jenkins", "Mathematics Department Lead", "active"]
      ];
    } else if (this.name === SHEETS.students) {
      initialRows = [
        ["Username", "Password", "Role", "Name", "Detail", "Status"],
        ["STU-042", hashPassword("password123"), "student", "Alexandra Chen", "Senior Secondary 3 (SS3 Alpha)", "active"],
        ["STU-011", hashPassword("password123"), "student", "Marcus Brody", "Class of 2023 Alumni", "graduated"],
        ["STU-099", hashPassword("password123"), "student", "Ethan Hunt", "Junior Secondary 1 (JSS1)", "inactive"]
      ];
    } else if (this.name === SHEETS.admission) {
      initialRows = [
        ["Submission Date", "Name", "Age", "Gender", "Class applied", "Phone", "Date of Birth", "Guardian", "Previous School", "Medical Conditions"],
        [new Date().toLocaleString(), "David Mark", "14", "Male", "SS1 Alpha", "+2348012345678", "2012-05-14", "Mr. Mark Senior", "Grace Academy", "None"]
      ];
    }

    localStorage.setItem(this.storageKey, JSON.stringify(initialRows));
  }

  getDataRange() {
    const raw = localStorage.getItem(this.storageKey) || "[]";
    const values = JSON.parse(raw);
    return {
      getValues: () => values
    };
  }

  appendRow(rowArray) {
    const raw = localStorage.getItem(this.storageKey) || "[]";
    const values = JSON.parse(raw);
    values.push(rowArray);
    localStorage.setItem(this.storageKey, JSON.stringify(values));
  }

  updateUser(username, updateData) {
    const raw = localStorage.getItem(this.storageKey) || "[]";
    const values = JSON.parse(raw);
    if (!values || values.length <= 1) return false;

    const headers = values[0];
    const uIndex = headers.indexOf("Username");
    const pIndex = headers.indexOf("Password");
    const nIndex = headers.indexOf("Name");
    const dIndex = headers.indexOf("Detail");
    const sIndex = headers.indexOf("Status");

    for (let i = 1; i < values.length; i++) {
      if (values[i][uIndex] === username) {
        if (updateData.password && pIndex !== -1) {
          values[i][pIndex] = hashPassword(updateData.password);
        }
        if (updateData.name && nIndex !== -1) {
          values[i][nIndex] = updateData.name;
        }
        if (updateData.detail && dIndex !== -1) {
          values[i][dIndex] = updateData.detail;
        }
        if (updateData.status && sIndex !== -1) {
          values[i][sIndex] = updateData.status;
        }
        localStorage.setItem(this.storageKey, JSON.stringify(values));
        return true;
      }
    }
    return false;
  }
}

/**
 * Local Token Store
 */
const localSessionStore = {
  set: (token, value) => localStorage.setItem(`dewisdom_sess_${token}`, value),
  get: (token) => localStorage.getItem(`dewisdom_sess_${token}`)
};

/**
 * UUID Generator
 */
function generateUUID() {
  return 'uuid-' + Math.random().toString(36).substring(2, 11) + '-' + Date.now();
}

/**
 * Lightweight JS SHA-256 for browser runtime
 */
function jsSHA256(ascii) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  
  var mathPow = Math.pow;
  var maxWord = mathPow(2, 32);
  var lengthProperty = 'length';
  var i, j;
  var result = '';

  var words = [];
  var asciiBitLength = ascii[lengthProperty] * 8;
  
  var hash = jsSHA256.h = jsSHA256.h || [];
  var k = jsSHA256.k = jsSHA256.k || [];
  var primeCounter = k[lengthProperty];

  var isComposite = {};
  for (var candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 300; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  
  ascii += '\x80';
  while (ascii[lengthProperty] % 64 - 56) ascii += '\x00';
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return;
    words[i >> 2] |= j << ((3 - i % 4) * 8);
  }
  words[words[lengthProperty]] = ((asciiBitLength / maxWord) | 0);
  words[words[lengthProperty]] = (asciiBitLength);
  
  for (j = 0; j < words[lengthProperty];) {
    var w = words.slice(j, j += 16);
    var oldHash = hash;
    hash = hash.slice(0, 8);
    
    for (i = 0; i < 64; i++) {
      var w15 = w[i - 15], w2 = w[i - 2];

      var a = hash[0], e = hash[4];
      var temp1 = hash[7]
        + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
        + ((e & hash[5]) ^ ((~e) & hash[6]))
        + k[i]
        + (w[i] = (i < 16) ? w[i] : (
            w[i - 16]
            + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
            + w[i - 7]
            + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
          ) | 0
        );
      
      var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
        + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      
      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }
    
    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }
  
  for (i = 0; i < 8; i++) {
    for (j = 3; j >= 0; j--) {
      var b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? 0 : '') + b.toString(16);
    }
  }
  return result;
}


// ============================================================================
// FRONTEND INTERFACE BRIDGE (BackendAPI)
// ============================================================================

const BackendAPI = {
  /**
   * Universal Request Dispatcher
   */
  async request(payload) {
    // If external Google Apps Script URL is provided, send real HTTP POST
    if (GOOGLE_APPS_SCRIPT_URL) {
      try {
        const res = await fetch(GOOGLE_APPS_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(payload)
        });

        const responseText = await res.text();
        let json;
        try {
          json = JSON.parse(responseText);
        } catch (e) {
          console.error("GAS returned non-JSON response (likely Google login page or error HTML):", responseText);
          return {
            status: "error",
            message: "Google Apps Script returned an invalid non-JSON response. Please ensure Web App deployment permissions are set to 'Anyone'."
          };
        }

        return json;
      } catch (err) {
        console.warn("External GAS backend request failed:", err);
        // Fall back to local execution engine
        const mockEvent = { postData: { contents: JSON.stringify(payload) } };
        const localResult = doPost(mockEvent);
        localResult.networkError = true;
        localResult.gasErrorDetails = err.toString();
        return localResult;
      }
    }

    // Direct local execution through doPost()
    const mockEvent = { postData: { contents: JSON.stringify(payload) } };
    return doPost(mockEvent);
  },

  /**
   * Helper: Login
   */
  async login(username, password) {
    const res = await this.request({ action: "login", username, password });
    
    if (res && res.status === "success") {
      const data = res.data || res;
      const roleRaw = (data.role || res.role || "student").toString().toLowerCase();
      
      return {
        status: "success",
        role: roleRaw,
        name: data.name || res.name || username,
        username: username,
        token: data.adminToken || res.token || "gas-session-token",
        detail: data.subRole || data.class || res.detail || "Member",
        studentStatus: data.status || res.studentStatus || "active",
        data: data
      };
    }
    return res;
  },

  /**
   * Helper: Submit Admission
   */
  async submitAdmission(admissionData) {
    return this.request({
      action: "submitAdmission",
      name: admissionData.name || admissionData.fullName || "N/A",
      age: admissionData.age || "N/A",
      gender: admissionData.gender || "N/A",
      intendingClass: admissionData.intendingClass || admissionData.classApplied || admissionData.classLevel || "N/A",
      whatsapp: admissionData.whatsapp || admissionData.phone || "N/A",
      medical: admissionData.medical || "None",
      dob: admissionData.dob || "N/A",
      prevSchool: admissionData.prevSchool || "N/A",
      guardianName: admissionData.guardianName || admissionData.guardian || "N/A"
    });
  },

  /**
   * Helper: Fetch Dashboard / System Data
   */
  async getDashboard(token) {
    if (GOOGLE_APPS_SCRIPT_URL) {
      const res = await this.request({
        action: "fetchSystemData",
        adminToken: ADMIN_SECRET_TOKEN
      });
      if (res && res.status === "success" && res.data && res.data.users) {
        return {
          status: "success",
          data: {
            users: res.data.users,
            students: res.data.users.filter(u => u.Role && u.Role.toLowerCase() === 'student'),
            staff: res.data.users.filter(u => u.Role && u.Role.toLowerCase() === 'staff')
          }
        };
      }
    }
    return this.request({ action: "getDashboard", token });
  },

  /**
   * Helper: Manage User (Add, Edit/Update, Delete)
   */
  async manageUser(token, operation, userType, userData) {
    let actionName = "addUser";
    if (operation === "edit" || operation === "update") {
      actionName = "updateUser";
    } else if (operation === "delete") {
      actionName = "deleteUser";
    }

    const payload = {
      action: actionName,
      adminToken: ADMIN_SECRET_TOKEN,
      username: userData.username || userData.id,
      role: userType || userData.role || "student",
      password: userData.password,
      name: userData.name,
      detail: userData.detail || userData.class || "",
      class: userData.detail || userData.class || "",
      subRole: userData.detail || userData.subRole || "",
      status: userData.status || "Active",
      folderId: userData.folderId || ""
    };

    if (GOOGLE_APPS_SCRIPT_URL) {
      return this.request(payload);
    }

    return this.request({ action: "manageUser", token, operation, userType, userData });
  }
};

// Export for Node/ESM module if available
if (typeof module !== "undefined" && module.exports) {
  module.exports = { doPost, respond, hashPassword, loginUser, submitAdmission, getDashboard, manageUser, BackendAPI };
}
