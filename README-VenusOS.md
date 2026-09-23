# Manual Installation Guide: signalk-czone on Victron Venus OS (Cerbo GX)

This guide provides step-by-step instructions for manually installing the [signalk-czone](https://github.com/mattsmitchell/signalk-czone) custom plugin onto a Victron Cerbo GX running Venus OS Large. 

By default, Venus OS runs on a read-only root file system and lacks Git. This walkthrough covers mounting the root partition as writable, updating packages, and using soft links to safely persist the installation across standard directories.

---

### Step 1: Enable Root Access on Venus OS
1. On your physical GX Touch screen or Remote Console dashboard, navigate to **Settings > General**.
2. Change the **Access Level** to **User and installer** (The default installer password is `zzz`).
3. Scroll down the menu, click **Set root password**, and configure a secure password.
4. Set **SSH on LAN** to **Enabled**.

### Step 2: SSH into the Cerbo GX
Open your computer's terminal (Terminal on macOS/Linux, or Command Prompt/PowerShell on Windows) and establish an SSH connection:
```bash
ssh root@<Your-Cerbo-GX-IP-Address>
```
*When prompted, type the root system password you created in Step 1.*

### Step 3: Mount and Install Git
Venus OS blocks unauthorized changes to its core file system structure by default. You must temporarily remount the root partition to allow the embedded Opkg package manager to pull down Git:
```bash
# Remount the root partition with write access permissions
mount -o remount,rw /

# Update the local package list indexes and download Git
opkg update
opkg install git
```

### Step 4: Clone and Install the Plugin
Navigate to the dedicated persistent plugin directory on your Cerbo GX. Clone the repository path into an entirely lowercase folder target name to prevent casing/indexing conflicts with the Cerbo's operating system environment:
```bash
# Navigate to the correct Venus OS plugin tracking directory
cd /data/conf/signalk-plugins/

# Clone the custom cZone repository directly using the exact lowercase path
git clone https://github.com/mattsmitchell/signalk-czone

# Enter the newly created workspace folder
cd signalk-czone

# Build the plugin binary packages while omitting heavy dev dependencies
npm install --omit=dev
```

### Step 5: Create a Soft Link for Signal K Registration
Create a symbolic soft link configuration mapping your custom lowercase tracking space directly into the active Signal K node modules folder location. This ensures Venus OS indexes it properly on startup:
```bash
ln -s /data/conf/signalk-plugins/signalk-czone /data/conf/signalk/node_modules/signalk-czone
```

### Step 6: Restart the Signal K Daemon
To force the active ecosystem environment to scan, register, and spin up your newly linked module, cycle the background server execution thread using one of these options:

* **Option A (Command Line - Recommended):** Trigger a fast process cycle directly from your current active SSH window terminal utilizing the internal daemontools management utility:
  ```bash
  svc -t /service/signalk-server
  ```
* **Option B (Web UI):** Open up your local web browser interface tracking your Signal K Admin dashboard configuration layout (`http://[Cerbo-GX-IP]:3000`), head directly down into **Server** or **Settings**, and select **Restart**.
* **Option C (Hardware Console):** Go to your physical GX touch display panel screen, scroll into `Settings > Venus OS large features`, toggle **Signal K** off, wait 10 seconds, and flick it back on.

### Step 7: Configure and Upload Your CZone .zcf File
1. Open up your [Signal K Server Admin UI](https://github.com/SignalK/signalk-server) panel and browse directly down to **Server** -> **Plugin Config** -> **CZone**.
2. Click on the custom configuration sub-panel module labeled **Upload and install ZCF**.
3. Select and upload your boat's active CZone `.zcf` configuration file from your computer. 
4. The plugin will automatically extract, validate, and dynamically map your customized circuit name identities directly to the web dashboard interface.

---

### Real-Time Diagnostics
To verify everything is parsing seamlessly or inspect incoming fast-packet JSON NMEA2000 frame streams directly on your Cerbo GX, stream your system logs utilizing this filter hook:
```bash
journalctl -u signalk --since "2 minutes ago" --no-pager | grep CZONE
```
