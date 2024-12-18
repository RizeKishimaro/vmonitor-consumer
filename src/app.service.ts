

import { HttpStatus, Injectable } from '@nestjs/common';
import { exec } from 'child_process';
import * as os from 'os-utils';
import * as osInfo from "os"
import axios from 'axios';
import * as fs from 'fs';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class AppService {
  constructor() {
    this.interfaceName = this.getNetworkInterface(); // Dynamically set the network interface
  } private prevRxBytes = 0;
  private prevTxBytes = 0;
  private path = '/etc/os-release';

  private readonly interfaceName: string;


  // Dynamically select the first active non-internal network interface
  private getNetworkInterface(): string {
    const networkInterfaces = osInfo.networkInterfaces();
    for (const [name, interfaces] of Object.entries(networkInterfaces)) {
      const activeInterface = interfaces?.find(
        (iface) => !iface.internal && iface.family === 'IPv4',
      );
      if (activeInterface) {
        console.log(`Using network interface: ${name}`);
        return name;
      }
    }

    // Fallback if no suitable network interface is found
    throw new Error('No active network interface found.');
  }


  private async getNetworkSpeed(): Promise<{ rxbytes: number; txbytes: number }> {
    return new Promise((resolve, reject) => {
      exec('cat /proc/net/dev', (error, stdout) => {
        if (error) {
          return reject(`Error executing command: ${error.message}`);
        }

        const lines = stdout.trim().split('\n');
        for (const line of lines) {
          if (line.includes(this.interfaceName)) {
            const parts = line.trim().split(/\s+/);
            const rxbytes = parseInt(parts[1], 10); // Received bytes
            const txbytes = parseInt(parts[9], 10); // Transmitted bytes
            return resolve({ rxbytes, txbytes });
          }
        }

        reject(`Network interface ${this.interfaceName} not found.`);
      });
    });
  }

  private formatSpeed(bytes: number): { value: string; unit: string } {
    const kbps = bytes / 1024; // Convert to KBps
    if (kbps > 1000) {
      return { value: (kbps / 1024).toFixed(2), unit: 'MBps' };
    }
    return { value: kbps.toFixed(2), unit: 'KBps' };
  }


  public async logNetworkSpeed(): Promise<any> {
    try {
      const { rxbytes, txbytes } = await this.getNetworkSpeed();

      const downloadSpeedBytes = rxbytes - this.prevRxBytes;
      const uploadSpeedBytes = txbytes - this.prevTxBytes;

      this.prevRxBytes = rxbytes;
      this.prevTxBytes = txbytes;

      return {
        downloadSpeed: downloadSpeedBytes,
        uploadSpeed: uploadSpeedBytes,
      };
    } catch (error) {
      console.error('Error logging network speed:', error);
      throw error;
    }
  }
  async getOsInfo() {
    const osType = osInfo.type();

    // Get platform (architecture)
    const platform = osInfo.arch();

    // Get CPU information
    const cpus = osInfo.cpus();
    const cpuCoreNames = cpus.map(cpu => cpu.model);

    // Get total RAM in GB
    const totalRam = (osInfo.totalmem() / (1024 ** 3)).toFixed(2);

    // Check if system has SSD or HDD
    function checkStorage() {
      const devices = fs.readdirSync('/sys/block');
      return devices.map(device => {
        const rotational = fs.readFileSync(`/sys/block/${device}/queue/rotational`, 'utf8').trim();
        return {
          device,
          type: rotational === '1' ? 'HDD' : 'SSD',
        };
      });
    }
    const storageBlock = checkStorage()
    // Get internal IP address
    const internalIp = osInfo.networkInterfaces();
    const internalIps = Object.values(internalIp)
      .flat()
      .filter(iface => iface.family === 'IPv4' && !iface.internal)
      .map(iface => iface.address);

    // Get public IP address (async)


    // Get public IP address (async)
    const publicIp = await this.getPublicIp();
    const distro = this.getLinuxDistro() || osType;
    return {
      statusCode: HttpStatus.OK,
      data: {
        storageBlock,
        distro,
        osType,
        platform,
        cpuCoreNames,
        totalRam,
        internalIps,
        publicIp
      }
    }

  }
  getLinuxDistro() {
    try {
      const osRelease = fs.readFileSync(this.path, 'utf8');
      const lines = osRelease.split('\n');
      const nameLine = lines.find(line => line.startsWith('PRETTY_NAME='));
      return nameLine ? nameLine.split('=')[1].replace(/"/g, '') : 'Unknown Linux Distribution';
    } catch (err) {
      console.error('Error reading OS release file:', err);
      return 'Unknown Linux Distribution';
    }
  }

  async getPublicIp(): Promise<string | void> {
    try {
      const response = await axios.get('https://api.ipify.org?format=json')
      return response.data.ip;
    } catch (error) {
      console.error('Error fetching public IP:', error);
    }
  }
  getCpuUsage(): Promise<number> {
    return new Promise((resolve) => {
      os.cpuUsage((usage) => {
        resolve(usage * 100); // Convert to percentage
      });
    });
  }

  async getDiskPartitions(): Promise<any[]> {
    const partitions: any[] = [];

    // Use `df` command to get the list of partitions
    const command = os.platform() === 'win32' ? 'wmic logicaldisk get name, size, freespace' : 'df -h';

    return new Promise((resolve, reject) => {
      exec(command, async (error, stdout) => {
        if (error) {
          return reject(`Error executing command: ${error.message}`);
        }

        const lines = stdout.trim().split('\n');

        // For Unix-like systems
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].trim().split(/\s+/);
          if (os.platform() === 'win32') {
            const filesystem = parts[0];
            const size = (parseInt(parts[1], 10) / (1024 ** 3)).toFixed(2); // Convert to GB
            const available = (parseInt(parts[2], 10) / (1024 ** 3)).toFixed(2); // Convert to GB
            const used = (parseInt(parts[1], 10) - parseInt(parts[2], 10)) / (1024 ** 3); // Calculate used in GB
            const usePercentage = `${(((parseInt(parts[1], 10) - parseInt(parts[2], 10)) / parseInt(parts[1], 10)) * 100).toFixed(2)}%)`; // Calculate use percentage

            partitions.push({ filesystem, size, used: used.toFixed(2), available, usePercentage });
          } else {
            const filesystem = parts[0];
            const size = this.convertSizeToGB(parts[1]); // Convert to GB
            const used = this.convertSizeToGB(parts[2]); // Convert to GB
            const available = this.convertSizeToGB(parts[3]); // Convert to GB
            const usePercentage = parts[4]; // Already in human-readable form

            partitions.push({ filesystem, size, used, available, usePercentage });
          }
        }

        resolve(partitions);
      });
    });
  }

  // Helper function to convert human-readable sizes to GB
  private convertSizeToGB(size: string): number {
    const unit = size.slice(-1).toUpperCase(); // Get the last character as unit
    const number = parseFloat(size); // Convert string to float

    switch (unit) {
      case 'G':
        return number; // Already in GB
      case 'M':
        return number / 1024; // Convert MB to GB
      case 'K':
        return number / (1024 ** 2); // Convert KB to GB
      case 'T':
        return number * 1024; // Convert TB to GB
      default:
        return 0; // Unknown unit
    }
  }
  async getMemoryUsage(): Promise<{ usedMemory: number; totalMemory: number; freeMemory: number }> {
    return new Promise((resolve) => {
      const totalMemory = os.totalmem(); // Total memory in bytes
      const freeMemory = os.freemem(); // Free memory in bytes
      const usedMemory = ((totalMemory - freeMemory) / totalMemory) * 100; // Used memory in percentage

      resolve({
        usedMemory: Math.round(usedMemory), // Round the percentage
        totalMemory,
        freeMemory,
      });
    });
  }

  formatSpeedToString(speedInBytes) {
    // Convert bytes to KiB
    const speedInKiB = Math.floor(speedInBytes / 1024); // Use Math.floor for integer result
    return speedInKiB;
  }
  async getPreviousNetworkData() {
    const response = await axios.get(`${process.env.MONITOR_SERVER_URL}/servers/${process.env.CLIENT_ID}/getNetworkLog`);
    return response.data
  }
  async getPreviousCPUData() {
    const response = await axios.get(`${process.env.MONITOR_SERVER_URL}/servers/${process.env.CLIENT_ID}/getRAMLog`);
    return response.data
  }
  async getPreviousRAMData() {
    const response = await axios.get(`${process.env.MONITOR_SERVER_URL}/servers/${process.env.CLIENT_ID}/getRAMLog`);
    return response.data
  }



  @Cron(CronExpression.EVERY_5_SECONDS)
  async logUsage(): Promise<void> {
    try {
      const cpuUsage = await this.getCpuUsage();
      const memoryUsage = await this.getMemoryUsage();
      const networkData = await this.logNetworkSpeed();

      const { usedMemory } = memoryUsage;
      const downloadSpeed = networkData.downloadSpeed; // in bytes
      const uploadSpeed = networkData.uploadSpeed;     // in bytes

      const formattedDownloadSpeed = this.formatSpeedToString(downloadSpeed);
      const formattedUploadSpeed = this.formatSpeedToString(uploadSpeed);

      const exceeds2MiB = downloadSpeed > 2 * 1024 * 1024 || uploadSpeed > 2 * 1024 * 1024;
      const exceeds70CPU = cpuUsage > 80; // Check CPU usage
      const exceeds70Memory = usedMemory > 80; // Check Memory usage

      // Insert data into the database if thresholds are exceeded



      let previousRAMData;
      let previousCPUData;
      if (exceeds70Memory) {

        console.log('Thresholds exceeded. Inserting data into the ram database...');
        if (!previousRAMData) {

          previousRAMData = await this.getPreviousRAMData();

          console.log(previousRAMData)
          await axios.post(`${process.env.MONITOR_SERVER_URL}/servers/${process.env.CLIENT_ID}/insertRAMLog`);
        }
      }
      else if (!exceeds70Memory && previousRAMData) {
        await axios.put(`${process.env.MONITOR_SERVER_URL}/servers/${process.env.CLIENT_ID}/updateRAMLog`);
      }

      if (exceeds70CPU) {
        previousCPUData = await this.getPreviousCPUData();

        console.log('Thresholds exceeded. Inserting data into the cpu database...');

        if (!previousCPUData) {
          await axios.post(`${process.env.MONITOR_SERVER_URL}/servers/${process.env.CLIENT_ID}/insertCPULog`);
        }
      } else if (!exceeds70Memory && previousCPUData) {
        await axios.put(`${process.env.MONITOR_SERVER_URL}/servers/${process.env.CLIENT_ID}/updateCPULog`);
      }

    } catch (error) {
    }
  }
}

