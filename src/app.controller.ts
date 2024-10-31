

import { Controller, Sse, Res, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Observable } from 'rxjs';


@Controller()
export class AppController {
  constructor(private readonly appService: AppService) { }
  @Get('disk-partitions') // New route to get disk partitions information
  async getDiskPartitions(): Promise<any[]> {
    const partitions = await this.appService.getDiskPartitions();


    return partitions.map(partition => ({
      filesystem: partition.filesystem,
      size: partition.size,
      used: partition.used,
      available: partition.available,
      usePercentage: partition.usePercentage,
    }));
  }
  @Sse("ram-usage") // Use SSE for streaming
  sendRamUsage(): Observable<any> {
    return new Observable(observer => {
      // Start interval to emit RAM usage every 3 seconds
      const ramUsageInterval = setInterval(async () => {
        const { usedMemory, totalMemory, freeMemory } = await this.appService.getMemoryUsage(); // Await RAM usage
        const timestamp = new Date().toLocaleString(); // Get current timestamp
        observer.next({ data: { timestamp, usedMemory, totalMemory, freeMemory } }); // Send complete data structure
      }, 3000);

      // Clear interval on observable completion
      return () => clearInterval(ramUsageInterval);
    });
  }
  @Sse('network-speed')
  networkSpeed(): Observable<any> {
    return new Observable(observer => {
      // Start interval to emit network speed every 3 seconds
      const networkSpeedInterval = setInterval(async () => {

        const data = await this.appService.logNetworkSpeed(); // Await network speed data
        const timestamp = new Date().toDateString() + "-" + new Date().toTimeString();
        observer.next({ data: { timestamp, ...data } }); // Emit the data with timestamp
      }, 3000);

      // Clear interval on observable completion
      return () => clearInterval(networkSpeedInterval);
    });
  }

  @Sse('cpu-usage')
  sendCpuUsage(): Observable<any> {
    return new Observable(observer => {
      // Start interval to emit CPU usage every second
      const cpuUsageInterval = setInterval(async () => {
        const usage = await this.appService.getCpuUsage(); // Await CPU usage
        const timestamp = new Date().toDateString() + "-" + new Date().toTimeString();
        observer.next({ data: { timestamp, usage } });
      }, 3000);

      // Clear interval on observable completion
      return () => clearInterval(cpuUsageInterval);
    });
  }
}

