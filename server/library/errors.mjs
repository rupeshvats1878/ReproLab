export class LibraryError extends Error {
  constructor(code, field) {
    super(code)
    this.code = code
    this.field = field
  }
}
