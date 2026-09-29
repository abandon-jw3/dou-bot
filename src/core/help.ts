import { Arg, Command, Controller, Inject, Module } from './metadata.js';
import type { HandlerMetadata } from './metadata.js';
import type { CommandArguments } from './arguments.js';

export const COMMAND_CATALOG = Symbol('command catalog');
interface CommandEntry {
  metadata: HandlerMetadata;
  arguments: CommandArguments;
}

/** Private per-application catalog; populated before any provider is constructed. */
export class CommandCatalog {
  private readonly entries = new Map<string, CommandEntry>();
  constructor(private readonly prefix: string) {}
  add(metadata: HandlerMetadata, arguments_: CommandArguments): void {
    const entry = { metadata, arguments: arguments_ };
    for (const name of [metadata.name, ...(metadata.options.aliases ?? [])])
      this.entries.set(name, entry);
  }
  usage(name: string): string {
    const entry = this.entries.get(name);
    if (!entry) return '';
    const usage = entry.arguments.help().usage;
    return `用法：${this.prefix}${entry.metadata.name}${usage ? ` ${usage}` : ''}`;
  }
  render(name?: string): string {
    if (name === undefined) {
      const entries = [...new Set(this.entries.values())].sort((a, b) =>
        a.metadata.name < b.metadata.name ? -1 : a.metadata.name > b.metadata.name ? 1 : 0,
      );
      return [
        '可用命令：',
        ...entries.map(
          ({ metadata }) =>
            `${this.prefix}${metadata.name}${metadata.options.description ? `：${metadata.options.description}` : ''}`,
        ),
        `使用 ${this.prefix}help <命令名> 查看详细用法。`,
      ].join('\n');
    }
    const entry = this.entries.get(name);
    if (!entry) return `未找到该命令。使用 ${this.prefix}help 查看命令列表。`;
    const { metadata, arguments: arguments_ } = entry;
    const aliases = metadata.options.aliases ?? [];
    return [
      this.usage(name),
      ...(metadata.options.description ? [metadata.options.description] : []),
      ...(aliases.length
        ? [`别名：${aliases.map((alias) => this.prefix + alias).join('、')}`]
        : []),
      ...arguments_.help().details,
    ].join('\n');
  }
}

@Controller()
class HelpController {
  constructor(@Inject(COMMAND_CATALOG) private readonly catalog: CommandCatalog) {}

  @Command('help', { aliases: ['帮助'], description: '查看命令列表或指定命令的用法' })
  help(@Arg(0, { name: '命令名' }) name?: string): string {
    return this.catalog.render(name);
  }
}

/** Import explicitly to register help / 帮助. Normal route-conflict rules apply. */
@Module({ controllers: [HelpController] })
export class HelpModule {}
