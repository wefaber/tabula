// Expected failures of the DB editor. graphql.ts turns them into GraphQL errors with the same stable code.
export class DbError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
