#!/usr/bin/env bash
# ==============================================================================
# InterDash — Proxmox VE API Token Termproxy Enabler
#
# Enables Proxmox VE API Tokens (e.g. root@pam!interdash) to authenticate with
# proxmox-termproxy and interactive container consoles.
#
# Background:
# In Proxmox VE, PVE::API2::AccessControl::create_ticket is invoked by proxmox-termproxy
# via localhost HTTP to validate VNC tickets. Upstream PVE rejects API token IDs
# (user@realm!tokenid) in lookup_username() as an invalid username.
# This script adds seamless token-ID splitting support to AccessControl.pm and
# installs an APT post-invoke hook so the patch survives PVE upgrades.
# ==============================================================================

set -e

ACCESS_CONTROL_PM="/usr/share/perl5/PVE/API2/AccessControl.pm"

if [ ! -f "$ACCESS_CONTROL_PM" ]; then
  echo "[-] Proxmox AccessControl.pm not found at $ACCESS_CONTROL_PM"
  echo "[-] Ensure this script is executed on a Proxmox VE hypervisor host."
  exit 1
fi

echo "[*] Applying InterDash Proxmox termproxy API Token patch to $ACCESS_CONTROL_PM..."

# Create backup if not already backed up
if [ ! -f "${ACCESS_CONTROL_PM}.orig" ]; then
  cp "$ACCESS_CONTROL_PM" "${ACCESS_CONTROL_PM}.orig"
fi

python3 - << 'PYEOF'
with open('/usr/share/perl5/PVE/API2/AccessControl.pm', 'r') as f:
    content = f.read()

target = """\t$username = PVE::AccessControl::lookup_username($username);
\tmy $rpcenv = PVE::RPCEnvironment::get();

\tmy $res;
\teval {
\t    # test if user exists and is enabled
\t    $rpcenv->check_user_enabled($username);"""

replacement = """\tmy ($clean_username, $tokenid) = PVE::AccessControl::split_tokenid($username, 1);
\tif ($tokenid) {
\t    $clean_username = PVE::AccessControl::lookup_username($clean_username);
\t    $username = $clean_username . '!' . $tokenid;
\t} else {
\t    $username = PVE::AccessControl::lookup_username($username);
\t}
\tmy $rpcenv = PVE::RPCEnvironment::get();

\tmy $res;
\teval {
\t    # test if user exists and is enabled
\t    if ($tokenid) {
\t\tmy $usercfg = cfs_read_file('user.cfg');
\t\tPVE::AccessControl::check_user_enabled($usercfg, $clean_username);
\t\tPVE::AccessControl::check_token_exist($usercfg, $clean_username, $tokenid);
\t    } else {
\t\t$rpcenv->check_user_enabled($username);
\t    }"""

if target in content:
    content = content.replace(target, replacement, 1)
    with open('/usr/share/perl5/PVE/API2/AccessControl.pm', 'w') as f:
        f.write(content)
    print("[+] InterDash termproxy API Token patch successfully applied to PVE::API2::AccessControl")
else:
    print("[+] Patch is already present or target code block was already patched.")
PYEOF

echo "[*] Checking Perl syntax..."
perl -c "$ACCESS_CONTROL_PM"

echo "[*] Reloading pvedaemon and pveproxy..."
systemctl reload-or-restart pvedaemon pveproxy

# Install APT post-invoke hook for persistence across upgrades
echo "[*] Installing persistent APT hook in /etc/apt/apt.conf.d/99pve-termproxy-token..."
cat << 'EOF' > /etc/apt/apt.conf.d/99pve-termproxy-token
DPkg::Post-Invoke { "/usr/local/bin/patch-pve-termproxy-token.sh || true"; };
EOF

# Install self to /usr/local/bin
cp "$0" /usr/local/bin/patch-pve-termproxy-token.sh 2>/dev/null || true
chmod +x /usr/local/bin/patch-pve-termproxy-token.sh 2>/dev/null || true

echo "[+] Proxmox termproxy API Token configuration is now 100% active and persistent!"
