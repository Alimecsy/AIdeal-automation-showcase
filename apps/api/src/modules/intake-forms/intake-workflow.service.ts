import { Injectable } from "@nestjs/common";
import { IntakeFormsService } from "./intake-forms.service";

@Injectable()
export class IntakeWorkflowService {
  constructor(private readonly intakeForms: IntakeFormsService) {}

  listForms(...args: Parameters<IntakeFormsService["listForms"]>) {
    return this.intakeForms.listForms(...args);
  }

  createForm(...args: Parameters<IntakeFormsService["createForm"]>) {
    return this.intakeForms.createForm(...args);
  }

  getPublicForm(...args: Parameters<IntakeFormsService["getPublicForm"]>) {
    return this.intakeForms.getPublicForm(...args);
  }

  createPublicSession(
    ...args: Parameters<IntakeFormsService["createPublicSession"]>
  ) {
    return this.intakeForms.createPublicSession(...args);
  }

  getPublicSession(...args: Parameters<IntakeFormsService["getPublicSession"]>) {
    return this.intakeForms.getPublicSession(...args);
  }

  savePublicSession(
    ...args: Parameters<IntakeFormsService["savePublicSession"]>
  ) {
    return this.intakeForms.savePublicSession(...args);
  }

  submitPublicSession(
    ...args: Parameters<IntakeFormsService["submitPublicSession"]>
  ) {
    return this.intakeForms.submitPublicSession(...args);
  }

  createUploadIntent(
    ...args: Parameters<IntakeFormsService["createUploadIntent"]>
  ) {
    return this.intakeForms.createUploadIntent(...args);
  }

  confirmUploadedDocument(
    ...args: Parameters<IntakeFormsService["confirmUploadedDocument"]>
  ) {
    return this.intakeForms.confirmUploadedDocument(...args);
  }
}
