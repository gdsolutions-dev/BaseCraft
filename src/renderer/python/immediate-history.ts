const MAX = 200;

/** The Immediate window's input history: at most 200 lines, no consecutive duplicate; Up/Down browse it. */
export class ImmediateHistory {
  private items: string[] = [];
  private pos = 0; // items.length = past the newest (the line being typed)
  private draft = '';

  push(line: string): void {
    if (line !== '' && this.items[this.items.length - 1] !== line) this.items.push(line);
    if (this.items.length > MAX) this.items.shift();
    this.pos = this.items.length;
  }

  /** Up: the previous line; `current` is kept as the draft when leaving the end. Stops at the oldest. */
  prev(current: string): string {
    if (this.items.length === 0) return current;
    if (this.pos === this.items.length) this.draft = current;
    this.pos = Math.max(0, this.pos - 1);
    return this.items[this.pos]!;
  }

  /** Down: the next line, then the draft. */
  next(): string {
    if (this.pos >= this.items.length) return this.draft;
    this.pos++;
    return this.pos === this.items.length ? this.draft : this.items[this.pos]!;
  }
}
