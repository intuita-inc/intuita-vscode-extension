import {buildFileNameHash, FileNameHash} from "../features/moveTopLevelNode/fileNameHash";
import {JobHash} from "../features/moveTopLevelNode/jobHash";
import {
    assertsNeitherNullOrUndefined,
    calculateLastPosition,
    IntuitaPosition, IntuitaRange,
    isNeitherNullNorUndefined
} from "../utilities";
import {JobKind, JobOutput} from "../jobs";
import {FilePermission, TextDocument, Uri} from "vscode";
import {getOrOpenTextDocuments} from "./vscodeUtilities";
import {Message, MessageBus, MessageKind} from "./messageBus";
import {buildRepairCodeFact, RepairCodeFact} from "../features/repairCode/factBuilder";
import {buildMoveTopLevelNodeFact, MoveTopLevelNodeFact} from "../features/moveTopLevelNode/2_factBuilders";
import {FactKind} from "../facts";
import {executeRepairCodeCommand} from "../features/repairCode/commandExecutor";
import {executeMoveTopLevelNodeAstCommandHelper} from "../features/moveTopLevelNode/4_astCommandExecutor";
import {RepairCodeUserCommand} from "../features/repairCode/userCommand";
import {buildRepairCodeJobHash} from "../features/repairCode/jobHash";
import {MoveTopLevelNodeUserCommand} from "../features/moveTopLevelNode/1_userCommandBuilder";
import {Container} from "../container";
import {Configuration} from "../configuration";
import {buildFileUri, buildJobUri} from "./intuitaFileSystem";
import {
    buildMoveTopLevelNodeJobs,
    calculateCharacterDifference,
    MoveTopLevelNodeJob
} from "../features/moveTopLevelNode/job";
import {RepairCodeJob} from "../features/repairCode/job";
import {destructIntuitaFileSystemUri} from "../destructIntuitaFileSystemUri";

type Job = MoveTopLevelNodeJob | RepairCodeJob;
type Fact = MoveTopLevelNodeFact | RepairCodeFact;

export class JobManager {
    protected _fileNames = new Map<FileNameHash, string>();
    protected _factMap = new Map<JobHash, Fact>();
    protected _moveTopLevelBlockHashMap = new Map<FileNameHash, Set<JobHash>>();
    protected _repairCodeHashMap = new Map<FileNameHash, Set<JobHash>>();
    protected _rejectedJobHashes = new Set<JobHash>();
    protected _jobMap = new Map<JobHash, Job>;

    public constructor(
        protected readonly _messageBus: MessageBus,
        protected readonly _configurationContainer: Container<Configuration>,
    ) {
        this._messageBus.subscribe(
            async (message) => {
                if (message.kind === MessageKind.readingFileFailed) {
                    setImmediate(
                        () => this._onReadingFileFailed(
                            message.uri,
                        ),
                    );
                }

                if (message.kind === MessageKind.createRepairCodeJob) {
                    setImmediate(
                        () => this._onCreateRepairCodeJob(
                            message,
                        )
                    );
                }

                if (message.kind === MessageKind.noTypeScriptDiagnostics) {
                    setImmediate(
                        () => this._onNoTypeScriptDiagnostics(
                            message,
                        ),
                    );
                }
            }
        );
    }

    public getJob(jobHash: JobHash): Job | null {
        return this._jobMap.get(jobHash) ?? null;
    }
    public getFileNameFromFileNameHash(fileNameHash: FileNameHash): string | null {
        return this._fileNames.get(fileNameHash) ?? null;
    }

    public getFileNameFromJobHash(
        jobHash: JobHash,
    ): string | null {
        return this._jobMap.get(jobHash)?.fileName ?? null;
    }

    public getFileNames() {
        return Array.from(this._fileNames.values());
    }

    public getFileJobs(fileNameHash: FileNameHash): ReadonlyArray<Job> {
        const set1 = this._moveTopLevelBlockHashMap.get(fileNameHash) ?? new Set();
        const set2 = this._repairCodeHashMap.get(fileNameHash) ?? new Set();

        const jobHashes = [...set1, ...set2];

        return jobHashes.map(
            (jobHash) => {
                if (this._rejectedJobHashes.has(jobHash)) {
                    return null;
                }

                return this._jobMap.get(jobHash);
            },
        )
            .filter(isNeitherNullNorUndefined);
    }

    public rejectJob(
        jobHash: JobHash,
    ) {
        const job = this.getJob(jobHash);
        assertsNeitherNullOrUndefined(job);

        const entries = Array.from(this._moveTopLevelBlockHashMap.entries())
            .concat(
                Array.from(this._repairCodeHashMap.entries())
            );

        const entry = entries.find(([ _, jobHashes]) => {
            return jobHashes.has(jobHash);
        });

        assertsNeitherNullOrUndefined(entry);

        const [ fileNameHash, jobHashes ] = entry;

        const fileName = this._fileNames.get(fileNameHash);

        assertsNeitherNullOrUndefined(fileName);

        jobHashes.delete(jobHash);

        this._rejectedJobHashes.add(jobHash);
        this._jobMap.delete(jobHash);

        this._messageBus.publish(
            {
                kind: MessageKind.updateDiagnostics,
                fileName,
            },
        );

        const uri = buildJobUri(job);

        this._messageBus.publish(
            {
                kind: MessageKind.changePermissions,
                uri,
                permissions: FilePermission.Readonly,
            },
        );
    }

    public executeJob(
        jobHash: JobHash,
        characterDifference: number,
    ): JobOutput {
        const job = this._jobMap.get(jobHash);
        const fact = this._factMap.get(jobHash);

        assertsNeitherNullOrUndefined(job);
        assertsNeitherNullOrUndefined(fact);

        let execution;

        if (job.kind === JobKind.moveTopLevelNode && fact.kind === FactKind.moveTopLevelNode) {
            execution = executeMoveTopLevelNodeAstCommandHelper(
                job.oldIndex,
                job.newIndex,
                characterDifference,
                fact.stringNodes,
                fact.separator,
            );
        } else if (
            job.kind === JobKind.repairCode && fact.kind === FactKind.repairCode
        ) {
            execution = executeRepairCodeCommand(fact);
        } else {
            throw new Error('');
        }

        const lastPosition = calculateLastPosition(execution.text, fact.separator);

        const range: IntuitaRange = [
            0,
            0,
            lastPosition[0],
            lastPosition[1],
        ];

        const position: IntuitaPosition = [
            execution.line,
            execution.character,
        ];

        return {
            range,
            text: execution.text,
            position,
        };
    }

    public getCodeActionJobs(
        fileName: string,
        position: IntuitaPosition,
    ): ReadonlyArray<Job & { characterDifference: number }> {
        const fileNameHash = buildFileNameHash(fileName);

        const jobs = this.getFileJobs(fileNameHash);

        return jobs
            .filter(
                ({ range }) => {
                    return range[0] <= position[0]
                        && range[2] >= position[0]
                        && range[1] <= position[1]
                        && range[3] >= position[1];
                },
            )
            .map(
                (job) => {
                    const fact = this._factMap.get(job.hash);

                    assertsNeitherNullOrUndefined(fact);

                    const characterDifference = fact.kind === FactKind.moveTopLevelNode
                        ? calculateCharacterDifference(fact, position)
                        : 0;

                    return {
                        ...job,
                        characterDifference,
                    };
                }
            )
            .filter(isNeitherNullNorUndefined);
    }

    public onFileTextChanged(
        document: TextDocument,
    ) {
        if (document.uri.scheme !== 'file') {
            return;
        }

        const { fileName } = document;
        const fileText = document.getText();

        const userCommand: MoveTopLevelNodeUserCommand = {
            kind: 'MOVE_TOP_LEVEL_NODE',
            fileName,
            fileText,
            options: this._configurationContainer.get(),
        };

        const fact = buildMoveTopLevelNodeFact(userCommand);

        if (!fact) {
            return;
        }

        const fileNameHash = buildFileNameHash(fileName);

        const oldJobHashes = this._moveTopLevelBlockHashMap.get(fileNameHash) ?? new Set();

        this._fileNames.set(fileNameHash, fileName);

        const newJobs = buildMoveTopLevelNodeJobs(userCommand, fact, this._rejectedJobHashes);

        const newJobHashes = new Set(
            newJobs.map(({ hash }) => hash)
        );

        oldJobHashes.forEach(
            (jobHash) => {
                const job = this._jobMap.get(jobHash);

                if (job?.kind === JobKind.repairCode) {
                    newJobHashes.add(jobHash);
                }
            }
        );

        newJobHashes.forEach((jobHash) => {
            this._factMap.set(jobHash, fact);
        });

        this._moveTopLevelBlockHashMap.set(fileNameHash, newJobHashes);

        newJobs.forEach((job) => {
            this._jobMap.set(
                job.hash,
                job,
            );
        });

        this._messageBus.publish(
            {
                kind: MessageKind.updateDiagnostics,
                fileName,
            },
        );

        oldJobHashes.forEach(
            (oldJobHash) => {
                if (newJobHashes.has(oldJobHash)) {
                    return;
                }
        
                const uri = buildJobUri({
                    fileName,
                    hash: oldJobHash,
                });
        
                this._messageBus.publish(
                    {
                        kind: MessageKind.deleteFile,
                        uri,
                    },
                );
            },
        );

        const uri = buildFileUri(document.uri);

        if (newJobs.length === 0) {
            this._messageBus.publish(
                {
                    kind: MessageKind.deleteFile,
                    uri,
                },
            );
        } else {
            this._messageBus.publish(
                {
                    kind: MessageKind.writeFile,
                    uri,
                    content: Buffer.from(fileText),
                    permissions: FilePermission.Readonly,
                },
            );
        }
    }

    protected async _onReadingFileFailed (
        uri: Uri
    ) {
        const destructedUri = destructIntuitaFileSystemUri(uri);

        if (!destructedUri) {
            return;
        }

        const fileName = destructedUri.directory === 'files'
            ? destructedUri.fsPath
            : this.getFileNameFromJobHash(destructedUri.jobHash);

        assertsNeitherNullOrUndefined(fileName);

        const textDocument = await getOrOpenTextDocuments(fileName);
        let text = textDocument[0]?.getText();

        assertsNeitherNullOrUndefined(text);

        if (destructedUri.directory === 'jobs') {
            const result = this
                .executeJob(
                    destructedUri.jobHash,
                    0,
                );

            if (result) {
                text = result.text;
            }
        }

        assertsNeitherNullOrUndefined(text);

        const content = Buffer.from(text);

        const permissions = destructedUri.directory === 'files'
            ? FilePermission.Readonly
            : null;

        this._messageBus.publish(
            {
                kind: MessageKind.writeFile,
                uri,
                content,
                permissions,
            },
        );
    }

    protected async _onCreateRepairCodeJob(
        message: Message & { kind: MessageKind.createRepairCodeJob },
    ) {
        const fileName = message.uri.fsPath;

        const fileNameHash = buildFileNameHash(fileName);

        this._fileNames.set(
            fileNameHash,
            fileName
        );

        const textDocuments = await getOrOpenTextDocuments(fileName);
        const fileText = textDocuments[0]?.getText() ?? '';

        const command: RepairCodeUserCommand = {
            fileName,
            fileText,
            kind: "REPAIR_CODE",
            range: message.range,
            replacement: message.replacement,
        };

        const fact = buildRepairCodeFact(command);

        const jobHash = buildRepairCodeJobHash(
            fileName,
            message.range,
        );

        this._factMap.set(jobHash, fact);

        const oldJobHashes = this._repairCodeHashMap.get(fileNameHash) ?? new Set();
        const newJobHashes = new Set<JobHash>();

        oldJobHashes.forEach(jobHash => {
            const job = this._jobMap.get(jobHash);

            if (job?.kind === JobKind.repairCode && job.version !== message.version) {
                return;
            }

            newJobHashes.add(jobHash);
        });

        
        newJobHashes.add(jobHash);

        this._repairCodeHashMap.set(fileNameHash, newJobHashes);

        const title = `Repair code on line ${message.range[0] + 1} at column ${message.range[1] + 1}`;

        const job: RepairCodeJob = {
            kind: JobKind.repairCode,
            fileName,
            hash: jobHash,
            title,
            range: message.range,
            replacement: message.replacement,
            version: message.version,
        };

        this._jobMap.set(
            job.hash,
            job,
        );

        this._messageBus.publish(
            {
                kind: MessageKind.updateDiagnostics,
                fileName,
            },
        );
    }

    protected _onNoTypeScriptDiagnostics(
        message: Message & { kind: MessageKind.noTypeScriptDiagnostics },
    ) {
        const fileName = message.uri.fsPath;

        const fileNameHash = buildFileNameHash(fileName);

        const oldJobHashes = this._repairCodeHashMap.get(fileNameHash) ?? new Set<JobHash>();

        if (!oldJobHashes.size) {
            console.log('No repair code jobs to delete upon receiving no TypeScript diagnostics message');

            return;
        }

        const newJobHashes = new Set<JobHash>();

        oldJobHashes.forEach(
            (jobHash) => {
                const job = this._jobMap.get(jobHash);

                if (!job) {
                    return;
                }

                if (job.kind !== JobKind.repairCode) {
                    newJobHashes.add(jobHash);

                    this._factMap.delete(jobHash);
                    this._jobMap.delete(jobHash);
                }
            }
        );

        this._repairCodeHashMap.set(
            fileNameHash,
            newJobHashes,
        );

        // outgoing
        this._messageBus.publish(
            {
                kind: MessageKind.updateDiagnostics,
                fileName,
            },
        );
    }
}
