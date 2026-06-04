// Public surface of the application package: the driven ports the Phase 1 use
// cases depend on. Use cases (UploadReportUseCase, the viewer loader,
// PromoteVersionUseCase) land in later slices (1d–1f). In-memory fakes for
// unit-testing those use cases are exported from the `./testing` subpath.
export * from './ports';
