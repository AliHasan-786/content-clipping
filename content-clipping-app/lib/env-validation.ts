import { FFmpegService } from './ffmpeg-service';
import { WhisperService } from './whisper-service';
import { ClaudeService } from './claude-service';
import Redis from 'ioredis';
import { prisma } from './prisma';

export interface ValidationResult {
  service: string;
  status: 'success' | 'error' | 'warning';
  message: string;
  details?: any;
}

export interface SystemValidation {
  valid: boolean;
  results: ValidationResult[];
  criticalErrors: number;
  warnings: number;
}

/**
 * Comprehensive system validation service
 */
export class EnvironmentValidator {
  /**
   * Validate all required environment variables
   */
  static validateEnvironmentVariables(): ValidationResult[] {
    const results: ValidationResult[] = [];
    
    // Required environment variables
    const required = [
      'DATABASE_URL',
      'NEXTAUTH_SECRET',
      'NEXTAUTH_URL',
    ];

    // Optional but recommended environment variables
    const optional = [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'REDIS_HOST',
      'REDIS_PORT',
      'REDIS_PASSWORD',
      'FFMPEG_PATH',
      'FFPROBE_PATH',
    ];

    // Check required variables
    for (const varName of required) {
      if (!process.env[varName]) {
        results.push({
          service: 'Environment Variables',
          status: 'error',
          message: `Required environment variable ${varName} is not set`,
        });
      } else {
        results.push({
          service: 'Environment Variables',
          status: 'success',
          message: `${varName} is configured`,
        });
      }
    }

    // Check optional variables
    for (const varName of optional) {
      if (!process.env[varName]) {
        results.push({
          service: 'Environment Variables',
          status: 'warning',
          message: `Optional environment variable ${varName} is not set`,
        });
      } else {
        results.push({
          service: 'Environment Variables',
          status: 'success',
          message: `${varName} is configured`,
        });
      }
    }

    return results;
  }

  /**
   * Validate database connection
   */
  static async validateDatabase(): Promise<ValidationResult> {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return {
        service: 'Database',
        status: 'success',
        message: 'Database connection successful',
      };
    } catch (error) {
      return {
        service: 'Database',
        status: 'error',
        message: `Database connection failed: ${error}`,
        details: { error: error.message },
      };
    }
  }

  /**
   * Validate Redis connection
   */
  static async validateRedis(): Promise<ValidationResult> {
    let redis: Redis | null = null;
    
    try {
      redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        retryDelayOnFailover: 100,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 5000,
      });

      const result = await redis.ping();
      
      if (result === 'PONG') {
        return {
          service: 'Redis',
          status: 'success',
          message: 'Redis connection successful',
        };
      } else {
        return {
          service: 'Redis',
          status: 'error',
          message: 'Redis ping failed',
        };
      }
    } catch (error) {
      return {
        service: 'Redis',
        status: 'error',
        message: `Redis connection failed: ${error}`,
        details: { error: error.message },
      };
    } finally {
      if (redis) {
        redis.disconnect();
      }
    }
  }

  /**
   * Validate FFmpeg installation
   */
  static async validateFFmpeg(): Promise<ValidationResult> {
    try {
      const isValid = await FFmpegService.validateInstallation();
      
      if (isValid) {
        return {
          service: 'FFmpeg',
          status: 'success',
          message: 'FFmpeg is properly installed and configured',
        };
      } else {
        return {
          service: 'FFmpeg',
          status: 'error',
          message: 'FFmpeg validation failed',
        };
      }
    } catch (error) {
      return {
        service: 'FFmpeg',
        status: 'error',
        message: `FFmpeg validation error: ${error}`,
        details: { error: error.message },
      };
    }
  }

  /**
   * Validate Whisper API configuration
   */
  static async validateWhisper(): Promise<ValidationResult> {
    try {
      if (!process.env.OPENAI_API_KEY) {
        return {
          service: 'Whisper API',
          status: 'warning',
          message: 'OpenAI API key not configured. Transcription will not work.',
        };
      }

      const isValid = await WhisperService.validateConfiguration();
      
      if (isValid) {
        return {
          service: 'Whisper API',
          status: 'success',
          message: 'Whisper API is properly configured',
        };
      } else {
        return {
          service: 'Whisper API',
          status: 'error',
          message: 'Whisper API configuration failed',
        };
      }
    } catch (error) {
      return {
        service: 'Whisper API',
        status: 'error',
        message: `Whisper API validation error: ${error}`,
        details: { error: error.message },
      };
    }
  }

  /**
   * Validate Claude API configuration
   */
  static async validateClaude(): Promise<ValidationResult> {
    try {
      if (!process.env.ANTHROPIC_API_KEY) {
        return {
          service: 'Claude API',
          status: 'warning',
          message: 'Anthropic API key not configured. Chat features will not work.',
        };
      }

      const claudeService = new ClaudeService();
      const isValid = await claudeService.validateConfiguration();
      
      if (isValid) {
        return {
          service: 'Claude API',
          status: 'success',
          message: 'Claude API is properly configured',
        };
      } else {
        return {
          service: 'Claude API',
          status: 'error',
          message: 'Claude API configuration failed',
        };
      }
    } catch (error) {
      return {
        service: 'Claude API',
        status: 'error',
        message: `Claude API validation error: ${error}`,
        details: { error: error.message },
      };
    }
  }

  /**
   * Validate file system permissions and directories
   */
  static async validateFileSystem(): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];
    const fs = require('fs').promises;
    const path = require('path');

    // Check upload directories
    const directories = [
      'public/uploads',
      'public/uploads/thumbnails',
      'temp',
      'temp/audio',
      'temp/clips',
    ];

    for (const dir of directories) {
      const fullPath = path.join(process.cwd(), dir);
      
      try {
        await fs.access(fullPath);
        results.push({
          service: 'File System',
          status: 'success',
          message: `Directory ${dir} exists and is accessible`,
        });
      } catch (error) {
        try {
          await fs.mkdir(fullPath, { recursive: true });
          results.push({
            service: 'File System',
            status: 'success',
            message: `Created directory ${dir}`,
          });
        } catch (createError) {
          results.push({
            service: 'File System',
            status: 'error',
            message: `Failed to create/access directory ${dir}: ${createError}`,
            details: { error: createError.message },
          });
        }
      }
    }

    return results;
  }

  /**
   * Check system resources
   */
  static validateSystemResources(): ValidationResult[] {
    const results: ValidationResult[] = [];
    const os = require('os');

    // Check available memory
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryUsagePercent = (usedMemory / totalMemory) * 100;

    if (memoryUsagePercent > 90) {
      results.push({
        service: 'System Resources',
        status: 'warning',
        message: `High memory usage: ${memoryUsagePercent.toFixed(1)}%`,
        details: { 
          totalMemory: Math.round(totalMemory / 1024 / 1024 / 1024),
          freeMemory: Math.round(freeMemory / 1024 / 1024 / 1024),
          unit: 'GB'
        },
      });
    } else {
      results.push({
        service: 'System Resources',
        status: 'success',
        message: `Memory usage: ${memoryUsagePercent.toFixed(1)}%`,
        details: { 
          totalMemory: Math.round(totalMemory / 1024 / 1024 / 1024),
          freeMemory: Math.round(freeMemory / 1024 / 1024 / 1024),
          unit: 'GB'
        },
      });
    }

    // Check CPU count
    const cpuCount = os.cpus().length;
    results.push({
      service: 'System Resources',
      status: 'success',
      message: `Available CPUs: ${cpuCount}`,
      details: { cpuCount },
    });

    return results;
  }

  /**
   * Run comprehensive system validation
   */
  static async validateSystem(): Promise<SystemValidation> {
    console.log('Starting comprehensive system validation...');
    
    const results: ValidationResult[] = [];

    // Run all validations
    results.push(...this.validateEnvironmentVariables());
    results.push(await this.validateDatabase());
    results.push(await this.validateRedis());
    results.push(await this.validateFFmpeg());
    results.push(await this.validateWhisper());
    results.push(await this.validateClaude());
    results.push(...await this.validateFileSystem());
    results.push(...this.validateSystemResources());

    // Count issues
    const criticalErrors = results.filter(r => r.status === 'error').length;
    const warnings = results.filter(r => r.status === 'warning').length;
    const valid = criticalErrors === 0;

    console.log(`Validation complete: ${results.length} checks, ${criticalErrors} errors, ${warnings} warnings`);

    return {
      valid,
      results,
      criticalErrors,
      warnings,
    };
  }

  /**
   * Print validation results to console
   */
  static printValidationResults(validation: SystemValidation): void {
    console.log('\n=== SYSTEM VALIDATION RESULTS ===\n');
    
    // Group by service
    const groupedResults = validation.results.reduce((acc, result) => {
      if (!acc[result.service]) {
        acc[result.service] = [];
      }
      acc[result.service].push(result);
      return acc;
    }, {} as Record<string, ValidationResult[]>);

    // Print each service
    Object.entries(groupedResults).forEach(([service, results]) => {
      console.log(`${service}:`);
      results.forEach(result => {
        const icon = result.status === 'success' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
        console.log(`  ${icon} ${result.message}`);
        if (result.details) {
          console.log(`      Details: ${JSON.stringify(result.details)}`);
        }
      });
      console.log('');
    });

    // Summary
    const totalChecks = validation.results.length;
    const successCount = validation.results.filter(r => r.status === 'success').length;
    
    console.log('=== SUMMARY ===');
    console.log(`Total checks: ${totalChecks}`);
    console.log(`Successful: ${successCount}`);
    console.log(`Warnings: ${validation.warnings}`);
    console.log(`Critical errors: ${validation.criticalErrors}`);
    console.log(`Overall status: ${validation.valid ? '✅ READY' : '❌ NOT READY'}`);
    console.log('');
    
    if (!validation.valid) {
      console.log('❌ System is not ready for production. Please fix critical errors before proceeding.');
    } else if (validation.warnings > 0) {
      console.log('⚠️ System is functional but has warnings. Consider addressing them for optimal performance.');
    } else {
      console.log('✅ System is fully validated and ready for production!');
    }
  }
}

// Startup validation helper
export async function validateOnStartup(): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    return; // Skip validation in production to avoid delays
  }

  console.log('🔍 Running startup validation...');
  
  try {
    const validation = await EnvironmentValidator.validateSystem();
    EnvironmentValidator.printValidationResults(validation);
    
    if (!validation.valid) {
      console.warn('⚠️ System validation failed. Some features may not work properly.');
    }
  } catch (error) {
    console.error('❌ Validation process failed:', error);
  }
}