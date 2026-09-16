# MANIFEST.sha256 — HAND-OVER PACK, revision 7
# regenerated 2026-08-30T11:39:57Z under WO-9 Group D
# covers 91 files: EVERY file in this pack except THIS file (the pack-root manifest) only.
# Full-depth walk. Nested MANIFEST.sha256 files ARE covered.
#
# rev7 adds: 07_TRACK_R/ (Track R reconciliation), 08_POST_PROMOTION/ (the plan + corrections),
#            09_OPTION2_PATCHES/ (three patches, PREPARED NOT APPLIED),
#            03_WO3/A5_* (full credential-scrub transcript, exit 0, 2476 per-test lines).
# rev7 corrects: four DRIFT records reclassified BLOCKED (WO-9 A1); UNKNOWN=0 wording (A2);
#            'two destructive-path functions' withdrawn (A3); 121 = 71 + 50 basis (A4);
#            'Track R not started' replaced (A7).
#
# ARCHIVE REPRODUCIBILITY: reproducible only under the stated construction — GNU tar 1.35,
# gzip 1.12, fixed file set, unchanged member mtimes, stable walk order. It breaks under a
# different tar, a different walk, or any mtime change. The manifest hash is the identity
# that survives all three.
#
# The release archive is built AFTER this manifest, OUTSIDE the pack, and is NOT a member.
# NOTHING IN THIS PACK CLOSES A SECTION 25 ROW (25.4).
# ledger-guard v3 here is UNFIXED (LG-05-DEF-1): 5 REAL + 3 FALSE POSITIVE of its 8 REV-16 FAILs.
# NESTED ARCHIVE MEMBER COUNTS (completeness, checkable without trusting this manifest):
#   01_WO1/WO1_evidence_pack_20260829.tar.gz  =  38 files
#   06_RAW/prod_captures/prod_raw_full_71.tar.gz  =  121 files
#   06_RAW/staging_captures/staging_raw_74.tar.gz  =  74 files
#   06_RAW/ws4_harness_pack.tar.gz  =  26 files
# sizes (bytes), same order:
#   00_INDEX.md                                                           26975
#   01_WO1/06_RESULTS_TEMPLATE.md                                         11393
#   01_WO1/BLOCKED.md                                                      7065
#   01_WO1/CAPTURE_END_UTC.txt                                               21
#   01_WO1/CAPTURE_START_UTC.txt                                             21
#   01_WO1/HARNESS_VERIFICATION_TRANSCRIPT.md                              1906
#   01_WO1/MANIFEST.sha256                                                 4544
#   01_WO1/SUMMARY.md                                                      5047
#   01_WO1/T1.8_IMAGEDIMS_COMPARISON.md                                    3258
#   01_WO1/T1_HASH_CROSS_VALIDATION.md                                     5323
#   01_WO1/WO1_evidence_pack_20260829.tar.gz                              83261
#   01_WO1/exports/row1_production_ad_creative_comments_policies.json       1361
#   01_WO1/exports/row2_staging_ad_creative_comments_policies.json         1312
#   01_WO1/exports/row6a_r2_buckets.json                                   1463
#   01_WO1/exports/two_capture_drift_check.json                             712
#   01_WO1/inventory.tsv                                                  22998
#   01_WO1/manifests/analyze-gallery-image.manifest.json                    890
#   01_WO1/manifests/backfill-image-dims.manifest.json                     1215
#   01_WO1/manifests/detect-ai-image.manifest.json                          885
#   01_WO1/manifests/measure-post-media.manifest.json                      1054
#   01_WO1/manifests/migrate-post-media.manifest.json                      1225
#   01_WO1/manifests/send-gift-credit.manifest.json                        1056
#   01_WO1/manifests/submit-judge-decision.manifest.json                   1060
#   01_WO1/production/functions/analyze-gallery-image/index.ts             4618
#   01_WO1/production/functions/backfill-image-dims/_shared/imageDims.ts       5156
#   01_WO1/production/functions/backfill-image-dims/_shared/s3.ts          9143
#   01_WO1/production/functions/backfill-image-dims/index.ts              12051
#   01_WO1/production/functions/detect-ai-image/index.ts                   5068
#   01_WO1/production/functions/measure-post-media/_shared/imageDims.ts       2542
#   01_WO1/production/functions/measure-post-media/index.ts               11687
#   01_WO1/production/functions/migrate-post-media/_shared/imageDims.ts       4041
#   01_WO1/production/functions/migrate-post-media/_shared/manifestPlan.ts      15849
#   01_WO1/production/functions/migrate-post-media/index.ts               12571
#   01_WO1/production/functions/send-gift-credit/_shared/secureHeaders.ts       1507
#   01_WO1/production/functions/send-gift-credit/index.ts                  5556
#   01_WO1/production/functions/submit-judge-decision/_shared/judgingAuth.ts       4381
#   01_WO1/production/functions/submit-judge-decision/index.ts            12632
#   01_WO1/production/list_edge_functions_raw.json                        32951
#   01_WO1/production/list_edge_functions_raw_capture2_20260829T183428Z.json      32951
#   01_WO1/staging/list_edge_functions_raw.json                           35356
#   02_WO2/ACCESS_IS_THE_BOTTLENECK.md                                     4213
#   02_WO2/CORS_CENSUS_71.json                                            12354
#   02_WO2/F19_refetch_verification.json                                   9679
#   02_WO2/FINDINGS_F16-F20_RESPONSE.md                                   14607
#   02_WO2/FINDINGS_F21-F26_RESPONSE.md                                   12942
#   02_WO2/LANE_DELTA.tsv                                                 23194
#   02_WO2/PROD_FUNCTIONS_WS-HASH-v1.tsv                                  16376
#   02_WO2/ROW2_AND_ROW6A_EVIDENCE.md                                      8755
#   02_WO2/STAGING_FUNCTIONS_WS-HASH-v1.tsv                               17021
#   02_WO2/WO2_HARNESS_VERIFICATION_2026-08-29.md                          8903
#   02_WO2/WO2_ITEM0_FULL_PACK_2026-08-30.md                               8067
#   02_WO2/WO2_ITEM0_STEP3_FIX_2026-08-30.md                               6206
#   02_WO2/WO2_ITEMS1-4_REPORT.md                                         13843
#   02_WO2/WS-HASH-v1_SPEC.md                                              6344
#   03_WO3/A5_CREDENTIAL_SCRUB_FULL_TRANSCRIPT.txt                       584360
#   03_WO3/A5_npm_ci_install.log                                           1326
#   03_WO3/WO3_138file_docs_references.txt                                 2324
#   03_WO3/WO3_REPORT_2026-08-30.md                                       22701
#   03_WO3/WO3_drift_702e5ce.json                                         14211
#   03_WO3/WO3_drift_a42b209e.json                                        14130
#   03_WO3/WO3_drift_harness.py                                            3882
#   03_WO3/WO3_test_credential_scrub_proof.txt                              741
#   04_REV17/FACTS_REV16_SUPERSEDED.md                                     5244
#   04_REV17/REV17_CORRECTION_SET_PREPARED_NOT_COMMITTED.md               18324
#   04_REV17/facts_rev16.json.ORIGINAL                                     3381
#   05_INSTRUMENTS/00_README_V3.md                                         2720
#   05_INSTRUMENTS/BLOCKED_ITEMS_V3.md                                     2806
#   05_INSTRUMENTS/INSTALLATION_GATE_LG-05-DEF-1.md                        6490
#   05_INSTRUMENTS/LG-05-DEF-1_AND_CORRECTED_CLASSIFICATION.md             8373
#   05_INSTRUMENTS/MANIFEST.sha256                                         1524
#   05_INSTRUMENTS/REV16_FINDING_CLASSIFICATION_V3.md                      3978
#   05_INSTRUMENTS/REV16_REPORT_V3.txt                                     1913
#   05_INSTRUMENTS/TRANSCRIPT_ci_linux.txt                                 1131
#   05_INSTRUMENTS/TRANSCRIPT_selftest_linux.txt                           5040
#   05_INSTRUMENTS/V3_FIX_EVIDENCE.md                                      5213
#   05_INSTRUMENTS/facts_rev16.json                                        3381
#   05_INSTRUMENTS/ledger-guard.yml                                        3662
#   05_INSTRUMENTS/ledger_guard.py                                        29338
#   05_INSTRUMENTS/test_ci_propagation.sh                                  4647
#   05_INSTRUMENTS/test_ledger_guard.sh                                   17913
#   05_INSTRUMENTS/verify_recompute.py                                     2952
#   06_RAW/prod_captures/prod_raw_full_71.tar.gz                         400913
#   06_RAW/staging_captures/staging_raw_74.tar.gz                        402693
#   06_RAW/ws4_harness_pack.tar.gz                                        77880
#   07_TRACK_R/TRACK_R_RECONCILIATION.md                                  13565
#   08_POST_PROMOTION/POST_PROMOTION_PLAN.md                              24253
#   09_OPTION2_PATCHES/00_OPTION2_README.md                                5999
#   09_OPTION2_PATCHES/01-apply-migration.yml.patch                        2933
#   09_OPTION2_PATCHES/02-verify-schema-dependencies.yml.patch              921
#   09_OPTION2_PATCHES/03-functions-_seo.ts.patch                          1044
#   RESUME_HERE.md                                                         6270
a7316c8b08bc5b51225f6403275f9705d6efdcdf5acea112585df475c7cd8de8  00_INDEX.md
9e5ca6bbce77c1578b8f637098f1932811b6677434569b2f2b8b8eea2ce94399  01_WO1/06_RESULTS_TEMPLATE.md
948a2ead5ca676125811f755d6eb75b4f18db09312f45b2c590b1fc1d00b85a3  01_WO1/BLOCKED.md
763035dfb2b6f9983ffce1179e4e91deaafcdd29a5df74f6e5dc8f0464513223  01_WO1/CAPTURE_END_UTC.txt
f7d83b7f45c0952921249e99597f281cba4c8effcde11977283f4346cb626e1e  01_WO1/CAPTURE_START_UTC.txt
c7aef46b0450fc2cf92f630944ba0b100d32909d8d7ed83f25611f2f838e51d6  01_WO1/HARNESS_VERIFICATION_TRANSCRIPT.md
e5c04c9f40d77252cf9bb073d5e62f56d3dd06221ed90e8699652cda4c8e0a52  01_WO1/MANIFEST.sha256
ceb3b3b83bc43029ba14e03d77423490a42797477ac8e597e48c3136f0062562  01_WO1/SUMMARY.md
3b3433cc66a994d320c0a036c973083bb468bde988741e7239b8fdb5f3abeac2  01_WO1/T1.8_IMAGEDIMS_COMPARISON.md
57d1bd09c6d15387f1bbfe101c8af3b05e930a537970a1f569bdc6e3236cfa2c  01_WO1/T1_HASH_CROSS_VALIDATION.md
9bb380b52755aa787ce1c8402d3e31869016f7bf9dc74c4b03dc6fd1f5fb7c02  01_WO1/WO1_evidence_pack_20260829.tar.gz
f599159e20b9dfabb51620326b6c0fa2e2b73f5e9d5791bd323948ac02ed80f9  01_WO1/exports/row1_production_ad_creative_comments_policies.json
5b4dc592b9bc7e7945a01163a0a0103d2320736290e36994fa811e09d6d89d9e  01_WO1/exports/row2_staging_ad_creative_comments_policies.json
f090c633d462371d32638bc0aeff0ee4d3a15ebc2a63c3cebc77186a410905e8  01_WO1/exports/row6a_r2_buckets.json
88bfd367b70b4c2f0818992571262cdeb8a272d6e8121d2a65d8ba1950d8fda8  01_WO1/exports/two_capture_drift_check.json
47eb05d461152fd2dc419531e8ab3603e2a13b92bed57f81964c6a9f63305d6e  01_WO1/inventory.tsv
a2f64a9902b1cb702714b3052ef2f880eaac70f48cf3862080b9a93ddb780945  01_WO1/manifests/analyze-gallery-image.manifest.json
28813e92e3b7f11f6edc0383493a220b36d24faeed35150d72c90a3023252e8f  01_WO1/manifests/backfill-image-dims.manifest.json
28f90de04c7cdb6a34d120cbe3c6eb3ea132b1a0303133ead6c50d789e4085b8  01_WO1/manifests/detect-ai-image.manifest.json
96cf1da93510a1978bf79a7ac2f53bc324fc27132d7836d143f3174fde646d28  01_WO1/manifests/measure-post-media.manifest.json
adf5c7a13275293fc620af3f32778b2cb68708c25ba5749d96ef8caee5586f1f  01_WO1/manifests/migrate-post-media.manifest.json
6060863ec9021fe4e4c21be6320261c4137a259610d36ee88485e8549b30d083  01_WO1/manifests/send-gift-credit.manifest.json
a49ea9c301ac5b54216f131e8d800b57e307040a11ff510c9e56805767290d91  01_WO1/manifests/submit-judge-decision.manifest.json
32128c486d8da56c30de039d88c3f3dc4b6d22fb2a2caf3cbe0283e48eefb87d  01_WO1/production/functions/analyze-gallery-image/index.ts
29499a56d639e715034a45e6ced172b648f6237345f857b9439d7ade3c4eb4b5  01_WO1/production/functions/backfill-image-dims/_shared/imageDims.ts
fd1f863616dbab7637bd2cac240ed989b652e53e8f8511c786d1e1d8474fb908  01_WO1/production/functions/backfill-image-dims/_shared/s3.ts
aeba3d18b3648299cbc3d761898dd05c77943b5f53e16a31955bf9e3b07eb900  01_WO1/production/functions/backfill-image-dims/index.ts
52d0ed4cc57af77b5b83e14791e9bd19b3534860637c10aaa27a02acbda4e3b1  01_WO1/production/functions/detect-ai-image/index.ts
461f8113fa8297c8ffcc9984d81a47af517ee6333797a0c8ca4e2b99074b07e7  01_WO1/production/functions/measure-post-media/_shared/imageDims.ts
d62fe4bb50a15a4d776427f75a3d8afc1e6ec13f20d7c8c38e05a3f569eb33c9  01_WO1/production/functions/measure-post-media/index.ts
cef53716fee1d3a3e5e0e97389b17ec0f00fa99f1b7620ce8cb382955fcf9573  01_WO1/production/functions/migrate-post-media/_shared/imageDims.ts
b95ce3612c15157213a495592abd62044152b55bb231ac734d7f01b8ea7ebd9d  01_WO1/production/functions/migrate-post-media/_shared/manifestPlan.ts
4f4cab99e846091012c4e9a7abb0c8744170715aa05b86a828635934b2107332  01_WO1/production/functions/migrate-post-media/index.ts
51e0dc23de36a29ff25d0e4ef622e34e2e6e371142970fc7cb44187078919310  01_WO1/production/functions/send-gift-credit/_shared/secureHeaders.ts
19836c92c8aa6f31c8c1a16e3b84a479c901afd9c42911d5a85f9e0019ea9480  01_WO1/production/functions/send-gift-credit/index.ts
50be62f6ac8bcdbf5e71c8b4332e83e9d24ebeefc7076e24342a24020c5421c2  01_WO1/production/functions/submit-judge-decision/_shared/judgingAuth.ts
9531b0ca5b9f71ba40843c2d6e80ce665dfd8930693d4df5ea99011563a36b44  01_WO1/production/functions/submit-judge-decision/index.ts
eb825b16ccc98bb21d3a75ab85655898cf1ee59ae228baf3444ce26f7c14e3a4  01_WO1/production/list_edge_functions_raw.json
eb825b16ccc98bb21d3a75ab85655898cf1ee59ae228baf3444ce26f7c14e3a4  01_WO1/production/list_edge_functions_raw_capture2_20260829T183428Z.json
ca5621fe4149c1f41987523b9d6162c2530d2b248dcaceed1952c1c5b39db370  01_WO1/staging/list_edge_functions_raw.json
44145b01b7a7b372c8f9111921c339cdbfdbad1fe5b4d9b6fc5fc6f9f820dac7  02_WO2/ACCESS_IS_THE_BOTTLENECK.md
be70bbc59ddaf9e5ee1bfc3f0a70d0e39c01b7aed751f4328e066df5e7b99303  02_WO2/CORS_CENSUS_71.json
f0ac34e6efddbb0232efdee75f1c0d92b65b7cb23590167075876f838c817dcd  02_WO2/F19_refetch_verification.json
a272f50035fecb5f9f9ce1b55bd3f59289f47914be50e66ac63b6043c7209e28  02_WO2/FINDINGS_F16-F20_RESPONSE.md
58631f433a09b8e71fdb072b680f5a9695ed9e6b36db116018fb8c245da879c9  02_WO2/FINDINGS_F21-F26_RESPONSE.md
5590f044be180c6c9bead16dc07c967661238ab58caae63c0bedcf16e9e70381  02_WO2/LANE_DELTA.tsv
e9b215b5e313781ac849f0228b3126199b70449e4c6097ff237f54be3fc8e6e9  02_WO2/PROD_FUNCTIONS_WS-HASH-v1.tsv
277832c8e35a07c2110c352acfb3678a6e8f44118d22ac8cd24dbf1f804cb2e7  02_WO2/ROW2_AND_ROW6A_EVIDENCE.md
299929e0155f7c031dd55ae5b7b15a6248e17a3d3608ededf16ff3947c4b0440  02_WO2/STAGING_FUNCTIONS_WS-HASH-v1.tsv
d2ab17fe5af95c1f324edf3688437f10638d54429b22f886fcd134733c7a773e  02_WO2/WO2_HARNESS_VERIFICATION_2026-08-29.md
7674e687d3b4044810cd748c6a8a5a768c9ced7902a888d7ecb4a7e3c87a1c57  02_WO2/WO2_ITEM0_FULL_PACK_2026-08-30.md
c995f71700ed0c8a11b850c866e1fbe20ab486abe717804d03f54924ff730777  02_WO2/WO2_ITEM0_STEP3_FIX_2026-08-30.md
d0ee77ce148ea0e47e98781367fd4a3cef2825c231e65f9ccec354eec6a8090b  02_WO2/WO2_ITEMS1-4_REPORT.md
77de14c2dfa2319389e93f99404c43e11f2bd5bb7119fede605e9e69d4b5ed65  02_WO2/WS-HASH-v1_SPEC.md
1319834fc3feec31667c44e13a0226963993a68755ad8cf87583619bfbc97c93  03_WO3/A5_CREDENTIAL_SCRUB_FULL_TRANSCRIPT.txt
3526ddbc0b2fe1770396195540f5eaccef1c55dbe354822891542e984cba0687  03_WO3/A5_npm_ci_install.log
f1d1c911d30718a3567a4b98c454c6a863612a36aa66dacc2e69b4daeed10dde  03_WO3/WO3_138file_docs_references.txt
1293cfdc7583a2a6c7e634b2e7cbef2d36747042370024025ade9869ddaa4c5a  03_WO3/WO3_REPORT_2026-08-30.md
4831e8d96ffa2da4f5f8d01aad75a41c5078aa46d15277bb95590c7e00737b30  03_WO3/WO3_drift_702e5ce.json
fd93415f3ee1d5cea73a98c0b095f349a1a21d3d97e27eda5ed7b119251b3e87  03_WO3/WO3_drift_a42b209e.json
71773365277bc1935732bdf55eb3d4d006914b01aba4944bff21ec8442adfeaf  03_WO3/WO3_drift_harness.py
af60c1dbb05ae0de69d144d3bb762193fc1c93c8b1c37c3d55ad92351a86ee96  03_WO3/WO3_test_credential_scrub_proof.txt
d3239bf05d9be6bdb3dd6801a44a571fbbab0ac94865f8b75585da8a1b2511c7  04_REV17/FACTS_REV16_SUPERSEDED.md
8db1b57a5373409d2be134c17288b3c5249dad0a0221b154bc5230eb1690aa05  04_REV17/REV17_CORRECTION_SET_PREPARED_NOT_COMMITTED.md
b343a7d1bd024300dde09013c11bd1bdc1b92abcda7aa5b87d1029336337dd0a  04_REV17/facts_rev16.json.ORIGINAL
404f9e6047338d6bd6c3f3a6ca1dc92f594e485a04cfc6a847384e6bd7596f25  05_INSTRUMENTS/00_README_V3.md
023302b33920ec22387f7c64f24d554c93fadebb044829392a9b480c3c4f5d1a  05_INSTRUMENTS/BLOCKED_ITEMS_V3.md
877882562cfb59ba30ed959ec403d7103f1bee9389426cdbae42cb8c1c70f277  05_INSTRUMENTS/INSTALLATION_GATE_LG-05-DEF-1.md
25d5cae6bb17eab78b958472e59110790d43d39513fd6fa265afe1938ded4ab9  05_INSTRUMENTS/LG-05-DEF-1_AND_CORRECTED_CLASSIFICATION.md
618b7e1f66d8054d609574af38d2f2ce9308929612281e066d8f07182f0faf48  05_INSTRUMENTS/MANIFEST.sha256
4a178c4705693cf4e822edf3e586ddfbd604f6cdf631859d43379902c301a8cc  05_INSTRUMENTS/REV16_FINDING_CLASSIFICATION_V3.md
844890d7b189912efd5ef1a9c95dc5c4de2dc8af640897140a99b0deecbdd3be  05_INSTRUMENTS/REV16_REPORT_V3.txt
440b4bcdf91c4e218cc37e6fb99f1ef079ba620401c4d10b4a7344525a6a2cf4  05_INSTRUMENTS/TRANSCRIPT_ci_linux.txt
df35fd74db1af25e578e4c34c973c309e7fe3c8226dd8f094ba31f2b36f807ca  05_INSTRUMENTS/TRANSCRIPT_selftest_linux.txt
6f499ddeae266f00299deeb22e712c89eda44e37aaf52c54c9687bbd4e261d95  05_INSTRUMENTS/V3_FIX_EVIDENCE.md
b343a7d1bd024300dde09013c11bd1bdc1b92abcda7aa5b87d1029336337dd0a  05_INSTRUMENTS/facts_rev16.json
3eafce220e79aca8f411bcd9c9b0e2d6de97d32b5f41c419cf186178b3d8a1cd  05_INSTRUMENTS/ledger-guard.yml
a9629fcf2d18d0ce7a3a2567e4471d261f2f963b503d3dcb6629c08274b79a42  05_INSTRUMENTS/ledger_guard.py
429eaa172305309b1723cabcf0a8f38d74d381134a5c2ae473f70bcd0e00c289  05_INSTRUMENTS/test_ci_propagation.sh
39e5bd950f9dd6884e25ef6e3a0e3a6e57593a5f9226ae94ac5e48f7b7560e91  05_INSTRUMENTS/test_ledger_guard.sh
5a99f442c2faba7613fca72b2099ac0d8ba5ac6f502f82bf3c181a80c45aaea6  05_INSTRUMENTS/verify_recompute.py
dee7c7bead779a4fa7f587736aa2348c672e42c05b251c46807c9bf0c60e29ca  06_RAW/prod_captures/prod_raw_full_71.tar.gz
41a934025327ab959813bf2274dedf057218a55c7fcf0d86c149da8b96b981d6  06_RAW/staging_captures/staging_raw_74.tar.gz
30b9eac20e6dd42bb17ad1dacb5d0672f838eaebc7a923e996ba442151112dd1  06_RAW/ws4_harness_pack.tar.gz
7206d3582515c5dcc5a3fcd60489d0398c029833b77a7f9947e0f6638ea58df0  07_TRACK_R/TRACK_R_RECONCILIATION.md
fd9b47a316745a0d2f39515dae8c5619d0f3811242cdc446c88e9edf8d75a716  08_POST_PROMOTION/POST_PROMOTION_PLAN.md
c554ca32b9eee4ec09c3852fe632c47fad401c37b39a575185a6dc79bda91233  09_OPTION2_PATCHES/00_OPTION2_README.md
2ad96918648a660e80b054b44811b6d9c0939b014ac18cbbb39a8f7cfda3e604  09_OPTION2_PATCHES/01-apply-migration.yml.patch
01fe29f5026a6e2c88845a678e8f52832e7d3ade80dc45a6a841b8368bbf9759  09_OPTION2_PATCHES/02-verify-schema-dependencies.yml.patch
53983b18b885c625b8b8ebb9734d0143a5a5906497f838810457b4728989ae11  09_OPTION2_PATCHES/03-functions-_seo.ts.patch
a748420ee89a9a446a405aeaab1d07ee38b395b0fa881e85c38a7e86ce62036d  RESUME_HERE.md
