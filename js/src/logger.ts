import winston from 'winston'
import chalk from 'chalk'

const { format, transports } = winston


class Logger {

  constructor() { }

  getFormat(label: string, colorize: boolean) {
    return format.combine(
      (colorize ? format.colorize() : format.simple()),
      format.label({ label }),
      format.splat(),
      format.timestamp(),
      format.printf((info) => {
        const title = colorize ? chalk.green.bold(info.label) : info.label
        return `<${title}>${info.timestamp}[${info.level}]: ${info.message}`
      })
    )
  }

  getConsoleLogger(label: string, level: LOGGING_LEVEL) {
    // display console log with colors
    const format = this.getFormat(label, true)
    return winston.createLogger(
      {
        format,
        transports: [new transports.Console()],
        level
      }
    )
  }

  getFileLogger(label: string, level: LOGGING_LEVEL) {
    const format = this.getFormat(label, false)
    return winston.createLogger({
      format,
      transports: [new transports.File({ filename: `./log/${label}.log` })],
      level
    })
  }

}



export enum LOGGING_LEVEL {
  ERROR = 'error',
  WARN = 'warn',
  INFO = "info",
  VERBOSE = "verbose",
  DEBUG = 'debug',
  SILLY = 'silly'
}


export default new Logger()