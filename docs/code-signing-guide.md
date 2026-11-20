# FlowGet Code Signing & Windows SmartScreen Elimination Guide

This guide details the step-by-step process for obtaining a code-signing certificate, signing the FlowGet Windows binaries (`flowget.exe`, NSIS installer, and MSI), and establishing reputation with **Microsoft SmartScreen** to prevent warnings like *"Windows protected your PC / Unknown Publisher"*.

---

## 1. Why Code Signing Is Required on Windows

When an unsigned or newly compiled application is downloaded via Chrome, Edge, or Firefox, Windows SmartScreen automatically flags it:
- **Red/Blue SmartScreen Banner**: *"Windows protected your PC - Microsoft Defender SmartScreen prevented an unrecognized app from starting."*
- Users must manually click *"More info"* and *"Run anyway"*.
- Browser warnings: *"flowget-setup.exe isn't commonly downloaded and might be dangerous."*

Digitally signing FlowGet with a trusted certificate establishes publisher identity, guarantees binary integrity, and builds SmartScreen reputation.

---

## 2. Choosing the Right Certificate Type

There are two primary types of code-signing certificates:

| Feature | Standard (OV) Code Signing | Extended Validation (EV) Code Signing | Azure Trusted Signing (Recommended) |
|---|---|---|---|
| **Publisher Verification** | Organization / Individual | Strict Organization (KYC) | Organization via Microsoft Azure |
| **Hardware Key Requirement** | Physical FIPS 140-2 Level 2 USB Token | Physical USB Token (e.g. YubiKey) or Cloud HSM | Cloud-native Microsoft HSM (Zero Hardware) |
| **SmartScreen Reputation** | Builds reputation over time (100–300 downloads) | **Instant zero-warning reputation** from day 1 | **Instant zero-warning reputation** from day 1 |
| **Price** | ~$200–$350 / year | ~$450–$700 / year | **Pay-as-you-go (~$9.99/mo)** |
| **CI/CD Integration** | Complex (requires USB redirection or Remote HSM) | Complex (requires Cloud HSM or YubiKey agent) | **Seamless native GitHub Actions / Azure DevOps** |

### Top Recommended Option: Azure Trusted Signing (formerly Microsoft Azure Code Signing)
Microsoft now offers **Azure Trusted Signing**, which replaces traditional physical USB dongles:
- **Direct integration with Microsoft PKI**.
- Instant SmartScreen trust.
- Simple GitHub Actions runner integration without maintaining physical hardware.

---

## 3. How to Obtain Azure Trusted Signing

1. **Azure Portal Setup**:
   - Go to [Azure Portal](https://portal.azure.com) -> Search for **Trusted Signing**.
   - Create a **Trusted Signing Account** in your organization's Azure subscription.
2. **Identity Verification**:
   - Create a **Certificate Profile** under your Trusted Signing Account.
   - Complete business organization verification (Dun & Bradstreet DUNS number, business registration, or GSTIN in India).
   - Approval typically takes 24–48 hours.
3. **IAM Permissions**:
   - Assign the `Trusted Signing Certificate Profile Signer` role to your deployment service principal or GitHub Actions OIDC identity.

---

## 4. Signing FlowGet Binaries Using `signtool.exe`

Once you have your certificate (either physical USB token or Azure Trusted Signing), sign all output binaries:

### Option A: Azure Trusted Signing (Automated CI/CD via `TrustedSigning.Client`)
```powershell
# Install Azure Trusted Signing dlib
dotnet tool install --global Azure.CodeSigning.Dlib

# Sign FlowGet Executable & Installer
signtool.exe sign `
  /v `
  /dlib "C:\Tools\Azure.CodeSigning.Dlib.dll" `
  /dmdf "metadata.json" `
  /fd SHA256 `
  /tr "http://timestamp.acs.microsoft.com" `
  /td SHA256 `
  "D:\Websites\I-download\src-tauri\target\release\flowget.exe"
```

### Option B: Traditional Token / PFX File
```powershell
# Sign with Hardware Token or PFX
signtool.exe sign `
  /f "path\to\flowget_cert.pfx" `
  /p "YourCertPassword" `
  /fd SHA256 `
  /tr "http://timestamp.digicert.com" `
  /td SHA256 `
  "D:\Websites\I-download\src-tauri\target\release\bundle\nsis\FlowGet_0.1.0_x64-setup.exe"
```

---

## 5. Automated GitHub Actions CI/CD Pipeline Template

Create `.github/workflows/release-and-sign.yml`:

```yaml
name: Build, Sign, and Release FlowGet

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: windows-latest
    permissions:
      id-token: write
      contents: write

    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Install Dependencies
        run: npm ci

      - name: Build Tauri App
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'FlowGet ${{ github.ref_name }}'

      - name: Azure Trusted Signing
        uses: azure/trusted-signing-action@v0.5.1
        with:
          azure-tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          azure-client-id: ${{ secrets.AZURE_CLIENT_ID }}
          azure-client-secret: ${{ secrets.AZURE_CLIENT_SECRET }}
          endpoint: 'https://eus.codesigning.azure.net'
          trusted-signing-account-name: 'flowget-signing'
          certificate-profile-name: 'flowget-prod'
          files-folder: 'src-tauri/target/release/bundle/nsis/'
          files-folder-filter: 'exe'
          file-digest: 'SHA256'
          timestamp-rfc3161: 'http://timestamp.acs.microsoft.com'
          timestamp-digest: 'SHA256'
```

---

## 6. How to Build SmartScreen Reputation Fast

If you use a Standard OV certificate initially:
1. **Submit to Microsoft Defender for Immediate Analysis**:
   - Go to [Microsoft Security Intelligence Developer Submission](https://www.microsoft.com/en-us/wdsi/filesubmission).
   - Submit `flowget-setup.exe` under *"Software Developer"* category.
   - Microsoft's automated scanner verifies clean telemetry within 2 hours, whitelisting that specific hash.
2. **Microsoft Partner Center Attestation**:
   - Sign up at [partner.microsoft.com](https://partner.microsoft.com).
   - Link your EV or Standard certificate.
   - Submit drivers or binaries for Windows Hardware Quality Labs (WHQL) / Partner attestation signing to grant global reputation across all Windows 10 & 11 PCs.
